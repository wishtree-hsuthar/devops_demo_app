import {
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { S3 } from '@aws-sdk/client-s3';
import {
    S3Client,
    PutObjectCommand,
    ListObjectsV2Command,
    GetObjectCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { createReadStream, readFileSync } from 'fs';

@Injectable()
export class AppService {
    constructor(private configService: ConfigService) {}
    getHello(): string {
        return 'Hello World!';
    }

    BucketConf = {
        Bucket: 'devops-wt-test',
    };

    async listFiles() {
        Logger.log('S3Service.listFiles');
        const client = await this.getS3();
        const command = new ListObjectsV2Command({
            Bucket: this.BucketConf.Bucket,
        });
        let keys = [];
        try {
            let isTruncated = true;

            let contents = '';

            while (isTruncated) {
                const { Contents, IsTruncated, NextContinuationToken } =
                    await client.send(command);
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
        console.log('Files', files);
        const filesStreams = [];
        files.map((file) => {
            const fileStream = createReadStream(file.path);
            filesStreams.push(fileStream);
        });
        const { originalname } = files[0];
        const s3 = this.getS3();

        const params = {
            Key: String(files[0].originalname),
            Bucket: this.BucketConf.Bucket,
            Body: filesStreams[0],
        };

        try {
            const command = new PutObjectCommand({ ...params });
            const s3Response = await s3.send(command);
            console.log('S3 Upload Response', s3Response);
            const fileUrl = await this.getObjectUrl(files[0].originalname);
            console.log('File URL', fileUrl);
            if (s3Response.$metadata.httpStatusCode === 200) {
                return {
                    statusCode: 200,
                    message: 'File uploaded successfully',
                    originalname,
                };
            }
        } catch (e) {
            console.log('Error ', e);
            throw new InternalServerErrorException(e);
        }
    }

    async getObjectUrl(Key: string) {
        Logger.log('S3Service.getObjectUrl');
        const client = await this.getS3();
        const command = new GetObjectCommand({
            Bucket: this.BucketConf.Bucket,
            Key,
        });
        return await getSignedUrl(client, command, { expiresIn: 60 * 100 }); // expires in 20 minutes
    }

    getS3() {
        console.log('ENV', process.env.AWS_ACCESS_KEY_ID);
        return new S3({
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
            region: this.configService.get('S3_BUCKET_REGION'),
            // endpoint: 's3.amazonaws.com',
        });
    }
}
