import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 200,
    message: {
        status: 429,
        error: "Too many requests. Please try again after 10 minutes."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

export default limiter;  