import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/**
 * Translate Prisma errors into client-safe HTTP responses. Without this a
 * duplicate email or an enum typo surfaces as "500 Internal server error".
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") {
        status = HttpStatus.CONFLICT;
        const target = Array.isArray(exception.meta?.target)
          ? (exception.meta?.target as string[]).join(", ")
          : String(exception.meta?.target ?? "value");
        message = `That ${target} is already in use`;
      } else if (exception.code === "P2025") {
        status = HttpStatus.NOT_FOUND;
        message = "Record not found";
      } else if (exception.code === "P2003") {
        status = HttpStatus.BAD_REQUEST;
        message = "This record is still referenced by other data";
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = "One of the submitted values is not valid";
    }

    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    const body = { statusCode: status, message, error: HttpStatus[status] };
    res.status(status).json(body);
  }
}
