export class AppError extends Error {
  constructor(public status: number, message: string, public code = 'ERRO') { super(message); }
}
export const bad = (msg: string, code = 'INVALIDO') => new AppError(400, msg, code);
export const forbidden = (msg: string, code = 'PROIBIDO') => new AppError(403, msg, code);
export const notFound = (msg: string) => new AppError(404, msg, 'NAO_ENCONTRADO');
export const conflict = (msg: string, code = 'CONFLITO') => new AppError(409, msg, code);
/** Precisa de PIN de gerente */
export const needManager = (msg: string) => new AppError(403, msg, 'PRECISA_GERENTE');
