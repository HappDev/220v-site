import { isTimeoutError, publicMessageFromErr, timeoutStatusCode } from "./userMessages.mjs";

export function clientError(res, status, message) {
  return res.status(status).json({ error: message });
}

export function serverError(res, req, err, publicMessage = "Внутренняя ошибка сервера") {
  const message = publicMessageFromErr(err, publicMessage);
  req.log?.error({ err }, publicMessage);
  return res.status(timeoutStatusCode(err)).json({ error: message });
}
