/// <reference types="node" />
/// <reference types="node" />
import type { ReadStream } from "node:fs";
import AWS from "aws-sdk";
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
interface InitOptions extends Partial<AWS.S3.ClientConfiguration> {
    baseUrl?: string;
    rootPath?: string;
    s3Options: AWS.S3.ClientConfiguration & {
        params: {
            Bucket: string;
            ACL?: string;
            signedUrlExpires?: string;
        };
    };
}
declare const _default: {
    init({ baseUrl, rootPath, s3Options, ...legacyS3Options }: InitOptions): {
        isPrivate(): boolean;
        getSignedUrl(file: File): Promise<{
            url: string;
        }>;
        uploadStream(file: File, customParams?: {}): Promise<void>;
        upload(file: File, customParams?: {}): Promise<void>;
        delete(file: File, customParams?: {}): Promise<void>;
    };
};
export default _default;
//# sourceMappingURL=index.d.ts.map