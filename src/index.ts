import type { ReadStream } from "node:fs";
import { getOr } from "lodash/fp";
import AWS from "aws-sdk";
import { isUrlFromBucket } from "./utils";

interface File {
  name: string;
  alternativeText?: string;
  caption?: string;
  width?: number;
  height?: number;
  formats?: Record<string, unknown>;
  hash: string;
  ext?: string;
  mime: string;
  size: number;
  url: string;
  previewUrl?: string;
  path?: string;
  provider?: string;
  provider_metadata?: Record<string, unknown>;
  stream?: ReadStream;
  buffer?: Buffer;
}

// TODO V5: Migrate to aws-sdk v3
// eslint-disable-next-line @typescript-eslint/no-var-requires
require("aws-sdk/lib/maintenance_mode_message").suppress = true;

function hasUrlProtocol(url: string) {
  // Regex to test protocol like "http://", "https://"
  return /^\w*:\/\//.test(url);
}

interface InitOptions extends Partial<AWS.S3.ClientConfiguration> {
  baseUrl?: string;
  rootPath?: string;
  s3Options: AWS.S3.ClientConfiguration & {
    params: {
      Bucket: string; // making it required
      ACL?: string;
      signedUrlExpires?: string;
    };
    dirTimeScope: "sec" | "min" | "hour" | "day";
  };
}

export default {
  init({ baseUrl, rootPath, s3Options, ...legacyS3Options }: InitOptions) {
    if (Object.keys(legacyS3Options).length > 0) {
      process.emitWarning(
        "S3 configuration options passed at root level of the plugin's providerOptions is deprecated and will be removed in a future release. Please wrap them inside the 's3Options:{}' property."
      );
    }

    const config = { ...s3Options, ...legacyS3Options };

    const S3 = new AWS.S3({
      apiVersion: "2006-03-01",
      ...config,
    });

    const filePrefix = rootPath ? `${rootPath.replace(/\/+$/, "")}/` : "";

    const getFileKey = (file: File) => {
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const seconds = String(date.getSeconds()).padStart(2, "0");

      let structuredPath = `${year}/${month}/`;

      const timeDetail = s3Options.dirTimeScope ?? "hour";

      // Add additional time detail based on the specified granularity
      switch (timeDetail) {
        case "day":
          structuredPath += `${day}/`;
          break;
        case "hour":
          structuredPath += `${day}/${hours}/`;
          break;
        case "min":
          structuredPath += `${day}/${hours}/${minutes}/`;
          break;
        case "sec":
          structuredPath += `${day}/${hours}/${minutes}/${seconds}/`;
          break;
      }

      const path = file.path ? `${file.path}/` : "";
      return `${filePrefix}${structuredPath}${path}${file.hash}${file.ext}`;
    };

    const ACL = getOr("public-read", ["params", "ACL"], config);

    const upload = (file: File, customParams = {}): Promise<void> =>
      new Promise((resolve, reject) => {
        const fileKey = getFileKey(file);

        if (!file.stream && !file.buffer) {
          reject(new Error("Missing file stream or buffer"));
          return;
        }

        const params = {
          Key: fileKey,
          Bucket: config.params.Bucket,
          Body: file.stream || file.buffer,
          ACL,
          ContentType: file.mime,
          ...customParams,
        };

        const onUploaded = (err: Error, data: AWS.S3.ManagedUpload.SendData) => {
          if (err) {
            return reject(err);
          }

          // set the bucket file url
          if (baseUrl) {
            // Construct the url with the baseUrl
            file.url = `${baseUrl}/${fileKey}`;
          } else {
            // Add the protocol if it is missing
            // Some providers like DigitalOcean Spaces return the url without the protocol
            file.url = hasUrlProtocol(data.Location) ? data.Location : `https://${data.Location}`;
          }
          (file as any).key = fileKey;
          resolve();
        };

        S3.upload(params, onUploaded);
      });

    return {
      isPrivate() {
        return ACL === "private";
      },
      async getSignedUrl(file: File): Promise<{ url: string }> {
        // Do not sign the url if it does not come from the same bucket.
        if (!isUrlFromBucket(file.url, config.params.Bucket, baseUrl)) {
          return { url: file.url };
        }

        const signedUrlExpires: string = getOr(15 * 60, ["params", "signedUrlExpires"], config); // 15 minutes

        return new Promise((resolve, reject) => {
          const fileKey = getFileKey(file);

          S3.getSignedUrl(
            "getObject",
            {
              Bucket: config.params.Bucket,
              Key: fileKey,
              Expires: parseInt(signedUrlExpires, 10),
            },
            (err, url) => {
              if (err) {
                return reject(err);
              }
              resolve({ url });
            }
          );
        });
      },
      uploadStream(file: File, customParams = {}) {
        return upload(file, customParams);
      },
      upload(file: File, customParams = {}) {
        return upload(file, customParams);
      },
      delete(file: File, customParams = {}): Promise<void> {
        return new Promise((resolve, reject) => {
          // delete file on S3 bucket
          const key = baseUrl ? file.url.split(baseUrl)[1]?.substring(1) : undefined;
          S3.deleteObject(
            {
              Key: key ?? file.name,
              Bucket: config.params.Bucket,
              ...customParams,
            },
            (err) => {
              if (err) {
                return reject(err);
              }

              resolve();
            }
          );
        });
      },
    };
  },
};
