import {
    Injectable,
    InternalServerErrorException,
    Logger,
    OnModuleInit,
} from '@nestjs/common';
import { S3 } from '@aws-sdk/client-s3';
import {
    PutObjectCommand,
    ListObjectsV2Command,
    GetObjectCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import {
    createReadStream,
    createWriteStream,
    readFileSync,
    unlinkSync,
} from 'fs';
import { InjectModel } from '@nestjs/mongoose';
import { S3File, S3FileDocument } from './schema/s3-files.schema';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import * as https from 'https';
import * as redis from 'redis';

@Injectable()
export class AppService implements OnModuleInit {
    constructor(
        private configService: ConfigService,
        @InjectModel(S3File.name) private s3FileSchema: Model<S3FileDocument>,
    ) {}

    redisClient: redis.RedisClientType;
    BucketConf = {
        Bucket: this.configService.get('BUCKET_NAME'),
    };
    s3Client: S3;

    async onModuleInit() {
        this.redisClient = redis.createClient({
            url: this.configService.get('REDIS_HOST'),
            database: 0,
            ...(this.configService.get('REDIS_AUTH_REQUIRED') === true
                ? { password: this.configService.get('REDIS_AUTH') }
                : {}),
        });
        await this.redisClient.connect();
        this.s3Client = this.getS3();
    }

    async listFiles() {
        Logger.log('S3Service.listFiles');

        const command = new ListObjectsV2Command({
            Bucket: this.BucketConf.Bucket,
        });
        let keys = [];
        try {
            let isTruncated = true;

            let contents = '';

            while (isTruncated) {
                const { Contents, IsTruncated, NextContinuationToken } =
                    await this.s3Client.send(command);
                console.log(
                    'Bucket List Data',
                    Contents,
                    IsTruncated,
                    NextContinuationToken,
                );
                const contentsList = Contents.map((c) => `${c.Key}`).join('\n');
                keys = Contents.map((c) => `${c.Key}`);
                contents += contentsList + '\n';
                isTruncated = IsTruncated;
                command.input.ContinuationToken = NextContinuationToken;
            }
        } catch (err) {
            console.error(err);
        }
        return keys;
    }

    async uploadFileToS3(files) {
        Logger.debug('Inside the UploadFilToS3');

        const filesStreams = [];
        files.map((file) => {
            const fileStream = createReadStream(file.path);
            filesStreams.push(fileStream);
        });

        const { originalname } = files[0];

        const uniqueId = uuidv4();
        const params = {
            Key: `${uniqueId}_${originalname}`,
            Bucket: this.BucketConf.Bucket,
            Body: filesStreams[0],
        };

        try {
            const command = new PutObjectCommand({ ...params });
            const s3Response = await this.s3Client.send(command);

            await this.s3FileSchema.create({
                originalName: originalname,
                s3Name: params.Key,
            });

            await this.redisClient.set(uniqueId, params.Key);

            if (s3Response.$metadata.httpStatusCode === 200) {
                unlinkSync(files[0].path);
                return {
                    statusCode: 200,
                    message: 'File uploaded successfully',
                    originalname,
                    s3Name: params.Key,
                };
            }
        } catch (e) {
            console.log('Error ', e);
            throw new InternalServerErrorException(e);
        }
    }

    async getObjectUrl(Key: string) {
        Logger.log('S3Service.getObjectUrl');
        const command = new GetObjectCommand({
            Bucket: this.BucketConf.Bucket,
            Key,
        });
        return await getSignedUrl(this.s3Client, command, {
            expiresIn: 60 * 1,
        });
    }

    getS3() {
        return new S3({
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
            region: this.configService.get('S3_BUCKET_REGION'),
            // endpoint: 's3.amazonaws.com',
        });
    }

    async downloadFileFromS3(s3Id: string) {
        const { s3Name, originalName } = await this.fetchS3DataFromCacheOrDB(
            s3Id,
        );

        const fileDownloadURL = await this.getObjectUrl(s3Name);
        const filePath = `assets/downloads/${originalName}`;

        await new Promise<void>((resolve, reject) => {
            https.get(fileDownloadURL, (res) => {
                const writeStream = createWriteStream(filePath);
                res.pipe(writeStream);
                writeStream.on('finish', () => {
                    writeStream.close();
                    console.log('Download Completed!');
                    resolve();
                });
            });
        });

        return filePath;
    }

    async fetchS3DataFromCacheOrDB(key: string) {
        let originalName;
        let s3Name;

        const cachedData = await this.redisClient.get(key);

        if (!cachedData) {
            Logger.debug('Not Found Data in Cache, Fetching from Database...');

            const getFileData = await this.s3FileSchema
                .findOne({
                    s3Name: new RegExp(`^${key}.*$`),
                })
                .exec();

            await this.redisClient.set(key, getFileData.s3Name);
            originalName = getFileData.originalName;
            s3Name = getFileData.s3Name;
        } else {
            Logger.debug('Found data from Cache!');

            s3Name = cachedData;
            originalName = cachedData.split(/_(.*)/s)[0];
        }
        return {
            originalName,
            s3Name,
        };
    }

    async deleteFileFromS3(s3Id: string) {
        const { s3Name } = await this.fetchS3DataFromCacheOrDB(s3Id);

        const deleteCommand = new DeleteObjectCommand({
            Bucket: this.BucketConf.Bucket,
            Key: s3Name,
        });

        await this.s3Client.send(deleteCommand);

        return {
            message: 'Object deleted successfully!',
        };
    }
}
