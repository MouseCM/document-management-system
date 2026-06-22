import cron from 'node-cron';
import { db } from './prisma';
import { minioClient, getBucketName } from './minio';

export const startCronJobs = () => {
  // Run everyday at midnight
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('Running retention policy cleanup job...');
      const config = await db.systemConfig.findUnique({ where: { key: 'RETENTION_DAYS' } });
      const retentionDays = parseInt(config?.value || '30'); // Default 30 days
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const oldVersions = await db.documentVersion.findMany({
        where: { createdAt: { lt: cutoffDate } }
      });

      for (const version of oldVersions) {
        // Remove from MinIO
        await minioClient.removeObject(getBucketName(), version.objectName);
        // Remove from DB
        await db.documentVersion.delete({ where: { id: version.id } });
      }

      console.log(`Cleaned up ${oldVersions.length} old versions.`);
    } catch (e) {
      console.error('Failed to run cleanup job', e);
    }
  });
};
