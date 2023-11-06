"use strict";
const fp = require("lodash/fp");
const AWS = require("aws-sdk");
const _interopDefault = (e) => e && e.__esModule ? e : { default: e };
const AWS__default = /* @__PURE__ */ _interopDefault(AWS);
const ENDPOINT_PATTERN = /^(.+\.)?s3[.-]([a-z0-9-]+)\./;
function isUrlFromBucket(fileUrl, bucketName, baseUrl = "") {
  const url = new URL(fileUrl);
  if (baseUrl) {
    return false;
  }
  const { bucket } = getBucketFromAwsUrl(fileUrl);
  if (bucket) {
    return bucket === bucketName;
  }
  return url.host.startsWith(`${bucketName}.`) || url.pathname.includes(`/${bucketName}/`);
}
function getBucketFromAwsUrl(fileUrl) {
  const url = new URL(fileUrl);
  if (url.protocol === "s3:") {
    const bucket = url.host;
    if (!bucket) {
      return { err: `Invalid S3 url: no bucket: ${url}` };
    }
    return { bucket };
  }
  if (!url.host) {
    return { err: `Invalid S3 url: no hostname: ${url}` };
  }
  const matches = url.host.match(ENDPOINT_PATTERN);
  if (!matches) {
    return { err: `Invalid S3 url: hostname does not appear to be a valid S3 endpoint: ${url}` };
  }
  const prefix = matches[1];
  if (!prefix) {
    if (url.pathname === "/") {
      return { bucket: null };
    }
    const index2 = url.pathname.indexOf("/", 1);
    if (index2 === -1) {
      return { bucket: url.pathname.substring(1) };
    }
    if (index2 === url.pathname.length - 1) {
      return { bucket: url.pathname.substring(1, index2) };
    }
    return { bucket: url.pathname.substring(1, index2) };
  }
  return { bucket: prefix.substring(0, prefix.length - 1) };
}
require("aws-sdk/lib/maintenance_mode_message").suppress = true;
function hasUrlProtocol(url) {
  return /^\w*:\/\//.test(url);
}
const index = {
  init({ baseUrl, rootPath, s3Options, ...legacyS3Options }) {
    if (Object.keys(legacyS3Options).length > 0) {
      process.emitWarning(
        "S3 configuration options passed at root level of the plugin's providerOptions is deprecated and will be removed in a future release. Please wrap them inside the 's3Options:{}' property."
      );
    }
    const config = { ...s3Options, ...legacyS3Options };
    const S3 = new AWS__default.default.S3({
      apiVersion: "2006-03-01",
      ...config
    });
    const filePrefix = rootPath ? `${rootPath.replace(/\/+$/, "")}/` : "";
    const getFileKey = (file) => {
      const date = /* @__PURE__ */ new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const time = String(date.getTime());
      const path = file.path ? `${file.path}/` : "";
      const structuredPath = `${year}/${month}/${day}/${time}/`;
      return `${filePrefix}${structuredPath}${path}${file.hash}${file.ext}`;
    };
    const ACL = fp.getOr("public-read", ["params", "ACL"], config);
    const upload = (file, customParams = {}) => new Promise((resolve, reject) => {
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
        ...customParams
      };
      const onUploaded = (err, data) => {
        if (err) {
          return reject(err);
        }
        if (baseUrl) {
          file.url = `${baseUrl}/${fileKey}`;
        } else {
          file.url = hasUrlProtocol(data.Location) ? data.Location : `https://${data.Location}`;
        }
        file.key = fileKey;
        resolve();
      };
      S3.upload(params, onUploaded);
    });
    return {
      isPrivate() {
        return ACL === "private";
      },
      async getSignedUrl(file) {
        if (!isUrlFromBucket(file.url, config.params.Bucket, baseUrl)) {
          return { url: file.url };
        }
        const signedUrlExpires = fp.getOr(
          15 * 60,
          ["params", "signedUrlExpires"],
          config
        );
        return new Promise((resolve, reject) => {
          const fileKey = getFileKey(file);
          S3.getSignedUrl(
            "getObject",
            {
              Bucket: config.params.Bucket,
              Key: fileKey,
              Expires: parseInt(signedUrlExpires, 10)
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
      uploadStream(file, customParams = {}) {
        return upload(file, customParams);
      },
      upload(file, customParams = {}) {
        return upload(file, customParams);
      },
      delete(file, customParams = {}) {
        return new Promise((resolve, reject) => {
          const key = baseUrl ? file.url.split(baseUrl)[1]?.substring(1) : void 0;
          S3.deleteObject(
            {
              Key: key ?? file.name,
              Bucket: config.params.Bucket,
              ...customParams
            },
            (err) => {
              if (err) {
                return reject(err);
              }
              resolve();
            }
          );
        });
      }
    };
  }
};
module.exports = index;
//# sourceMappingURL=index.js.map
