import { db } from './prisma';

export const logAudit = async (action: 'CREATE' | 'UPLOAD' | 'VIEW' | 'DOWNLOAD' | 'EDIT', userId: number, documentId: number | null, ipAddress: string) => {
  try {
    await db.auditLog.create({
      data: {
        action,
        userId,
        documentId,
        ipAddress
      }
    });
  } catch (error) {
    console.error('Failed to write audit log', error);
  }
};
