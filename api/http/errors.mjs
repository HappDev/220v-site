export function clientError(res, status, message) {
  return res.status(status).json({ error: message });
}

export function serverError(res, req, err, publicMessage = "Internal error") {
  req.log?.error({ err }, publicMessage);
  return res.status(500).json({ error: publicMessage });
}
