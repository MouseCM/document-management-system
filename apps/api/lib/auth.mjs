const ROLE_RANK = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

const CLASSIFICATION_RANK = {
  public: 1,
  internal: 2,
  confidential: 3,
  restricted: 4,
};

function roleAtLeast(role, minimum) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[minimum] || 0);
}

function classificationAllowed(role, classification) {
  const clearance = {
    viewer: 2,
    editor: 3,
    admin: 4,
  }[role] || 0;
  return clearance >= (CLASSIFICATION_RANK[classification] || 0);
}

export function getDepartmentRole(store, userId, departmentId) {
  return store.state.departmentRoles.find((entry) => entry.userId === userId && entry.departmentId === departmentId)?.role || null;
}

export function getProjectRole(store, userId, projectId) {
  return store.state.projectRoles.find((entry) => entry.userId === userId && entry.projectId === projectId)?.role || null;
}

export function getEffectiveRole(store, userId, document) {
  const projectRole = document.projectId ? getProjectRole(store, userId, document.projectId) : null;
  if (projectRole) {
    return { role: projectRole, source: 'project' };
  }
  const departmentRole = getDepartmentRole(store, userId, document.departmentId);
  return { role: departmentRole, source: 'department' };
}

export function getProject(store, projectId) {
  return store.state.projects.find((project) => project.id === projectId) || null;
}

export function getUser(store, userId) {
  return store.state.users.find((user) => user.id === userId) || null;
}

export function businessHoursRange(store) {
  const settings = store.getSettings();
  return {
    start: settings.businessHoursStart || '08:00',
    end: settings.businessHoursEnd || '18:00',
  };
}

export function isWithinBusinessHours(timeString, store) {
  const { start, end } = businessHoursRange(store);
  const current = timeString || new Date().toTimeString().slice(0, 5);
  return current >= start && current <= end;
}

export function canScopeUserToDocument(store, user, document) {
  const project = document.projectId ? getProject(store, document.projectId) : null;
  const scopeDepartmentId = project ? project.departmentId : document.departmentId;
  return user.departmentId === scopeDepartmentId;
}

export function authorize(store, user, document, action, context = {}) {
  if (!user) {
    return { allowed: false, reason: 'No active user' };
  }

  const project = document.projectId ? getProject(store, document.projectId) : null;
  const projectStatus = project?.status || 'active';
  const effective = getEffectiveRole(store, user.id, document);
  const role = effective.role;
  const withinScope = canScopeUserToDocument(store, user, document);
  const accessTime = context.accessTime || null;
  const businessHours = isWithinBusinessHours(accessTime, store);
  const sameUser = user.id === document.ownerUserId;

  if (!withinScope) {
    return { allowed: false, reason: 'Outside department scope', role, projectStatus };
  }

  if (!role) {
    return { allowed: false, reason: 'No department or project role assigned', role: null, projectStatus };
  }

  if ((action === 'edit' || action === 'upload' || action === 'create') && projectStatus === 'archived') {
    return { allowed: false, reason: 'Archived projects are read-only', role, projectStatus };
  }

  if (!classificationAllowed(role, document.classification) && !sameUser) {
    return { allowed: false, reason: 'Classification exceeds clearance', role, projectStatus };
  }

  if ((action === 'view' || action === 'download') && roleAtLeast(role, 'viewer')) {
    return { allowed: true, role, projectStatus, effectiveRoleSource: effective.source };
  }

  if ((action === 'edit' || action === 'upload' || action === 'create') && !businessHours && !roleAtLeast(role, 'admin') && !sameUser) {
    return { allowed: false, reason: 'Outside business hours', role, projectStatus };
  }

  if (action === 'create') {
    return {
      allowed: roleAtLeast(role, 'editor'),
      reason: roleAtLeast(role, 'editor') ? null : 'Editor role required',
      role,
      projectStatus,
      effectiveRoleSource: effective.source,
    };
  }

  if (action === 'upload' || action === 'edit') {
    return {
      allowed: roleAtLeast(role, 'editor'),
      reason: roleAtLeast(role, 'editor') ? null : 'Editor role required',
      role,
      projectStatus,
      effectiveRoleSource: effective.source,
    };
  }

  return { allowed: false, reason: 'Not permitted', role, projectStatus };
}

export function listVisibleDocuments(store, user, accessTime) {
  return store.state.documents
    .map((document) => {
      const decision = authorize(store, user, document, 'view', { accessTime });
      return decision.allowed
        ? {
            ...document,
            effectiveRole: decision.role,
            effectiveRoleSource: decision.effectiveRoleSource,
            projectStatus: getProject(store, document.projectId)?.status || 'active',
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function roleLabel(role) {
  return role ? role.toUpperCase() : 'NONE';
}
