const { createHmac, timingSafeEqual } = require('node:crypto');

function decodeSegment(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new Error('Invalid token encoding.');
  }
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function authenticateToken(req, res, next) {
  const authorization = req.get('authorization');
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    return res.status(401).json({ message: 'A valid Bearer token is required.' });
  }

  try {
    const [headerSegment, payloadSegment, signatureSegment, ...extraSegments] = match[1].split('.');
    if (!headerSegment || !payloadSegment || !signatureSegment || extraSegments.length > 0 || !process.env.JWT_SECRET) {
      throw new Error('Invalid token.');
    }

    const header = decodeSegment(headerSegment);
    const payload = decodeSegment(payloadSegment);
    if (!header || header.alg !== 'HS256' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Unsupported token.');
    }

    const expectedSignature = createHmac('sha256', process.env.JWT_SECRET)
      .update(`${headerSegment}.${payloadSegment}`)
      .digest();
    const actualSignature = Buffer.from(signatureSegment, 'base64url');
    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
      throw new Error('Invalid token signature.');
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== 'campus-service-hub-auth' || typeof payload.sub !== 'string' || !payload.sub ||
        !['student', 'admin'].includes(payload.role) || typeof payload.exp !== 'number' || now >= payload.exp ||
        (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || now < payload.nbf))) {
      throw new Error('Token claims are invalid or expired.');
    }

    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'The token is invalid or has expired.' });
  }
}

module.exports = { authenticateToken };
