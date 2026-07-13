import { PrismaClient } from "@prisma/client";

/** Single shared Prisma client for the process — avoids exhausting the
 * database's connection pool by opening one per request. */
export const prisma = new PrismaClient();
