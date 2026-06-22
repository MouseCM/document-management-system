import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { db } from './prisma';
import { initMinio, minioClient, getBucketName } from './minio';
import { authMiddleware, checkAccess } from './auth';
import { logAudit } from './audit';
import { comparePdf, compareWord, compareText } from './diff';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ 
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  storage: multer.memoryStorage()
});

// Setup Initial routes
app.get('/api/ping', (req, res) => res.json({ msg: 'pong' }));

// 1. Upload new Document
app.post('/api/documents', authMiddleware, checkAccess('EDITOR'), upload.single('file'), async (req, res) => {
  try {
    const { title, description, projectId } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File is required' });

    // Server-Side Encryption config for MinIO (SSE-C) - optional usage based on SDK, we will use default MinIO SSE 
    // In production, we should pass an encryption key
    const objectName = `${Date.now()}-${file.originalname}`;
    await minioClient.putObject(getBucketName(), objectName, file.buffer, file.size, {
      'Content-Type': file.mimetype,
    });

    // Save metadata
    const doc = await db.document.create({
      data: {
        title,
        description,
        projectId: parseInt(projectId),
        authorId: req.user.id,
      }
    });

    await db.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNum: 1,
        objectName,
        fileSize: file.size,
        mimeType: file.mimetype,
        uploadedBy: req.user.id
      }
    });

    await logAudit('CREATE', req.user.id, doc.id, req.ip || '');
    await logAudit('UPLOAD', req.user.id, doc.id, req.ip || '');

    res.json(doc);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Upload new version to existing document
app.post('/api/documents/:id/versions', authMiddleware, checkAccess('EDITOR'), upload.single('file'), async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File is required' });

    const doc = await db.document.findUnique({ where: { id: documentId }, include: { versions: true } });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const objectName = `${Date.now()}-${file.originalname}`;
    await minioClient.putObject(getBucketName(), objectName, file.buffer, file.size, {
      'Content-Type': file.mimetype,
    });

    const newVersionNum = doc.versions.length + 1;
    const docVersion = await db.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNum: newVersionNum,
        objectName,
        fileSize: file.size,
        mimeType: file.mimetype,
        uploadedBy: req.user.id
      }
    });

    await logAudit('EDIT', req.user.id, doc.id, req.ip || '');
    await logAudit('UPLOAD', req.user.id, doc.id, req.ip || '');

    res.json(docVersion);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Download / View Document
app.get('/api/documents/:id/versions/:versionId/download', authMiddleware, async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const versionId = parseInt(req.params.versionId);
    const version = await db.documentVersion.findUnique({ where: { id: versionId } });
    
    if (!version) return res.status(404).json({ error: 'Not found' });

    const stream = await minioClient.getObject(getBucketName(), version.objectName);
    
    await logAudit('DOWNLOAD', req.user.id, documentId, req.ip || '');
    
    res.setHeader('Content-Type', version.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${version.objectName}"`);
    stream.pipe(res);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Compare Document Versions
app.get('/api/documents/:id/compare', authMiddleware, async (req, res) => {
  try {
    const v1Id = parseInt(req.query.v1 as string);
    const v2Id = parseInt(req.query.v2 as string);

    const v1 = await db.documentVersion.findUnique({ where: { id: v1Id } });
    const v2 = await db.documentVersion.findUnique({ where: { id: v2Id } });

    if (!v1 || !v2) return res.status(404).json({ error: 'Versions not found' });

    const stream1 = await minioClient.getObject(getBucketName(), v1.objectName);
    const stream2 = await minioClient.getObject(getBucketName(), v2.objectName);

    const buffer1 = await streamToBuffer(stream1);
    const buffer2 = await streamToBuffer(stream2);

    let diff;
    if (v1.mimeType.includes('pdf')) {
      diff = await comparePdf(buffer1, buffer2);
    } else if (v1.mimeType.includes('word') || v1.mimeType.includes('officedocument')) {
      diff = await compareWord(buffer1, buffer2);
    } else {
      diff = compareText(buffer1.toString('utf8'), buffer2.toString('utf8'));
    }

    res.json({ diff });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Utility
const streamToBuffer = (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
};

import { startCronJobs } from './cron';

const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`Server started on port ${port}`);
  await initMinio();
  console.log('MinIO initialized');
  startCronJobs();
  console.log('Cron jobs started');
});
