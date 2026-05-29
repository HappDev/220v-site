import { z } from "zod";
import { EMAIL_RE, REF_UUID_RE } from "../config.mjs";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => EMAIL_RE.test(v), { message: "Invalid email" });

export const sendCodeSchema = z.object({
  email: emailSchema,
  ref_uuid: z
    .string()
    .trim()
    .regex(REF_UUID_RE, "Invalid ref_uuid")
    .optional(),
});

export const verifySchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{5}$/, "Code must be 5 digits"),
  ref_uuid: z
    .string()
    .trim()
    .regex(REF_UUID_RE, "Invalid ref_uuid")
    .optional(),
});
