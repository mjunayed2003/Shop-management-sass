import { Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class PhoneNormalizerService {
  /**
   * Normalizes any Bangladesh phone number to standard 11-digit canonical format: 01XXXXXXXXX
   * Handles formats:
   * - +8801711223344 -> 01711223344
   * - 8801711223344  -> 01711223344
   * - 01711223344    -> 01711223344
   * - 01711-223344   -> 01711223344
   * - +88 017 1122 3344 -> 01711223344
   */
  normalize(rawPhone: string): string {
    if (!rawPhone || typeof rawPhone !== 'string') {
      throw new BadRequestException('Phone number is required.');
    }

    // Strip whitespace, hyphens, parentheses, plus signs
    let digits = rawPhone.trim().replace(/[^\d]/g, '');

    // Strip BD country code prefixes (880 or +880)
    if (digits.startsWith('880')) {
      digits = digits.substring(2); // keeps leading 0: 88017... -> 017...
    }

    // If starts with 1 and length is 10 (e.g. 1711223344), prepend 0
    if (digits.length === 10 && digits.startsWith('1')) {
      digits = '0' + digits;
    }

    // Validate standard BD mobile number format: 11 digits starting with 01
    const bdRegex = /^01[3-9]\d{8}$/;
    if (!bdRegex.test(digits)) {
      throw new BadRequestException(
        `Invalid Bangladesh mobile phone number "${rawPhone}". Must be an 11-digit valid operator number (e.g. 017XXXXXXXX).`,
      );
    }

    return digits;
  }
}
