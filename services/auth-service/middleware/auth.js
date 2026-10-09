const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
  const authorization = req.get('authorization');
  const [scheme, token] = authorization ? authorization.split(' ') : [];

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'A valid Bearer token is required.' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'campus-service-hub-auth',
    });
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'The token is invalid or has expired.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource.' });
    }

    return next();
  };
}

module.exports = { authenticateToken, requireRole };
