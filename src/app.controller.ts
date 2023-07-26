import {
    Controller,
    Get,
    HttpStatus,
    Param,
    ParseFilePipeBuilder,
    Post,
    Res,
    UploadedFiles,
    UseInterceptors,
} from '@nestjs/common';
import { AppService } from './app.service';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { parse } from 'path';
import { Response } from 'express';
import { unlink, unlinkSync } from 'fs';

const multerConfiguration = {
    storage: diskStorage({
        destination: 'assets',
        filename: (req: any, file, cb) => {
            const filename: string = `${uuidv4()}`;
            const extension: string = parse(file.originalname).ext;
            cb(null, `${filename}${extension}`);
        },
    }),
    limits: { fileSize: 50 * 1024 * 1024, fieldNameSize: 250 },
};

@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Get()
    getHello(): string {
        return this.appService.getHello();
    }

    @UseInterceptors(
        FilesInterceptor('files[]', 100, {
            ...multerConfiguration,
        }),
    )
    @Post('upload')
    async uploadFile(
        @UploadedFiles(
            new ParseFilePipeBuilder()
                // .addMaxSizeValidator({ maxSize: 50 * 1024 * 1024 })
                .build({
                    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
                }),
        )
        files: Array<Express.Multer.File>,
    ) {
        return this.appService.uploadFileToS3(files);
    }

    @Get('list/files')
    async listBucketFiles() {
        return this.appService.listFiles();
    }

    @Get('s3/download/:s3Id')
    async downloadFileFromS3(
        @Param('s3Id') s3Id: string,
        @Res() res: Response,
    ) {
        const fileLocation = await this.appService.downloadFileFromS3(s3Id);
        return res.download(fileLocation, () => {
            unlinkSync(fileLocation);
        });
    }
}
