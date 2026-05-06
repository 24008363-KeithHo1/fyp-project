module.exports = function(allowed = []){
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    const role = req.user.role && req.user.role.name;
    if (!role) return res.status(403).json({ error: 'No role assigned' });
    if (Array.isArray(allowed) && allowed.length && !allowed.includes(role)){
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  }
}
