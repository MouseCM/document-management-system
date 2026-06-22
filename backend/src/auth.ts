import { Request, Response, NextFunction } from 'express';
import { db } from './prisma';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

// Simplified mock authentication.
// In a real app, this would verify a JWT.
// For this mini-project, we accept a "user-id" header or default to User ID 1 (Admin).
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let userId = parseInt(req.header('x-user-id') || '1');
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      // Create default mock admin user if DB is empty
      const newUser = await db.user.create({
        data: {
          id: userId,
          email: `user${userId}@dms.local`,
          name: `User ${userId}`,
          password: 'password'
        }
      });
      req.user = newUser;
    } else {
      req.user = user;
    }
    next();
  } catch (error) {
    res.status(500).json({ error: 'Auth failed' });
  }
};

// Access Control Logic: Project Role > Department Role
export const checkAccess = (requiredRole: 'VIEWER' | 'EDITOR' | 'ADMIN') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user.id;
      const projectId = parseInt(req.params.projectId || req.body.projectId);

      if (!projectId) {
         // If no projectId, we allow the request but it's on the controller to handle logic
         return next();
      }

      const project = await db.project.findUnique({ where: { id: projectId }});
      if (!project) return res.status(404).json({ error: 'Project not found' });

      let roleLevel = 0; // 0=none, 1=VIEWER, 2=EDITOR, 3=ADMIN

      const getLevel = (r: string) => {
        if (r === 'ADMIN') return 3;
        if (r === 'EDITOR') return 2;
        if (r === 'VIEWER') return 1;
        return 0;
      };

      // 1. Check Project Level
      const pRole = await db.userProjectRole.findUnique({
        where: { userId_projectId: { userId, projectId } }
      });

      if (pRole) {
        roleLevel = getLevel(pRole.role);
      } else {
        // 2. Check Department Level
        const dRole = await db.userDepartmentRole.findUnique({
          where: { userId_departmentId: { userId, departmentId: project.departmentId } }
        });
        if (dRole) {
          roleLevel = getLevel(dRole.role);
        }
      }

      const requiredLevel = getLevel(requiredRole);

      if (roleLevel < requiredLevel) {
        return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
      }

      next();
    } catch (e) {
      res.status(500).json({ error: 'Access control error' });
    }
  };
};
