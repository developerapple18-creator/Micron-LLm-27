import express from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { csrfProtection, HttpError, sessionMiddleware } from './lib/security.js';
import pinoHttp from 'pino-http';
import router from './routes/index.js';
import { logger } from './lib/logger.js';
const app = express();
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split('?')[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.set('trust proxy', 1);
app.use(
  helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }),
);
app.use(express.json({ limit: '160kb' }));
app.use(sessionMiddleware);
app.use(csrfProtection);
app.use('/api', router);
app.use((_req, res) => {
  res.status(404).json({ error: 'المسار غير موجود.' });
});
app.use((error, req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'تحقق من البيانات المدخلة. كلمة المرور الجديدة يجب أن تكون بين ١٢ و١٢٨ حرفًا.',
    });
    return;
  }
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'صيغة الطلب غير صحيحة.' });
    return;
  }
  req.log.error({ errorType: error instanceof Error ? error.name : 'Unknown' }, 'Request failed');
  res.status(500).json({ error: 'تعذر تنفيذ الطلب. يرجى المحاولة لاحقًا.' });
});
export default app;
