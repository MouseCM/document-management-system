import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.systemConfig.upsert({
    where: { key: 'RETENTION_DAYS' },
    update: {},
    create: { key: 'RETENTION_DAYS', value: '30' }
  });

  const user = await prisma.user.upsert({
    where: { email: 'admin@dms.local' },
    update: {},
    create: {
      email: 'admin@dms.local',
      name: 'Admin User',
      password: 'password'
    }
  });

  const dept = await prisma.department.upsert({
    where: { name: 'IT Department' },
    update: {},
    create: { name: 'IT Department' }
  });

  const project = await prisma.project.create({
    data: {
      name: 'DMS Implementation',
      departmentId: dept.id
    }
  });

  await prisma.userDepartmentRole.upsert({
    where: { userId_departmentId: { userId: user.id, departmentId: dept.id } },
    update: {},
    create: {
      userId: user.id,
      departmentId: dept.id,
      role: 'ADMIN'
    }
  });

  console.log('Seed completed.');
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
