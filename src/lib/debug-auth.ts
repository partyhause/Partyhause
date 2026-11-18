export function debugAuthCache() {
  try {
    const token = localStorage.getItem('partyhause_auth_token');
    const user = localStorage.getItem('partyhause_auth_user');
    console.log('[Auth Debug]', {
      hasToken: !!token,
      tokenLength: token?.length ?? 0,
      hasUser: !!user,
      user: user ? JSON.parse(user) : null,
    });
    return { hasToken: !!token, hasUser: !!user };
  } catch (e) {
    console.error('[Auth Debug] error', e);
    return { hasToken: false, hasUser: false };
  }
}
