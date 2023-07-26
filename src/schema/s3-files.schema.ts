import { Schema, SchemaFactory, Prop } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type S3FileDocument = S3File & Document;

@Schema({ timestamps: true })
export class S3File {
    @Prop({ type: String })
    originalName: string;

    @Prop({ type: String })
    s3Name: string;
}

export const S3FileSchema = SchemaFactory.createForClass(S3File);
