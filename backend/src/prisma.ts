import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: null // Use direct database connection if adapter is null, or leave undefined if URL is passed elsewhere
});

// Since Prisma 7, we might need to pass the connection string directly if not using the default config, but let's try standard instantiation first.
// Wait, if prisma.config.ts manages the url, we might just instantiate:
export const db = new PrismaClient();
