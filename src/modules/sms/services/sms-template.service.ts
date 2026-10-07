import { Injectable } from '@nestjs/common';
import { SmsPurpose } from '../../../generated/prisma/client.js';

export interface TemplateVariables {
  customerName?: string;
  invoiceNo?: string;
  total?: string | number;
  paid?: string | number;
  due?: string | number;
  shopName?: string;
  message?: string;
  otp?: string;
}

export interface SegmentAnalysis {
  charCount: number;
  isUnicode: boolean;
  segmentCount: number;
  estimatedCost: number;
}

@Injectable()
export class SmsTemplateService {
  private readonly templates: Record<SmsPurpose, { en: string; bn: string }> = {
    [SmsPurpose.SALE_INVOICE]: {
      en: 'Thank you for shopping at {{shopName}}! Invoice: {{invoiceNo}}, Total: BDT {{total}}, Paid: BDT {{paid}}, Due: BDT {{due}}.',
      bn: '{{shopName}}-এ কেনাকাটার জন্য ধন্যবাদ! চালান: {{invoiceNo}}, মোট: ৳{{total}}, পরিশোধ: ৳{{paid}}, বাকি: ৳{{due}}।',
    },
    [SmsPurpose.DUE_REMINDER]: {
      en: 'Dear {{customerName}}, you have an outstanding due of BDT {{due}} at {{shopName}}. Please settle your payment.',
      bn: 'প্রিয় {{customerName}}, {{shopName}}-এ আপনার ৳{{due}} বকেয়া রয়েছে। অনুগ্রহ করে বকেয়া পরিশোধ করুন।',
    },
    [SmsPurpose.OTP]: {
      en: 'Your verification code for {{shopName}} is {{otp}}. Valid for 5 minutes.',
      bn: '{{shopName}}-এর ভেরিফিকেশন কোড: {{otp}}। মেয়াদ ৫ মিনিট।',
    },
    [SmsPurpose.PROMOTIONAL]: {
      en: 'Dear {{customerName}}, special offer at {{shopName}}! {{message}}',
      bn: 'প্রিয় {{customerName}}, {{shopName}}-এ বিশেষ অফার! {{message}}',
    },
  };

  /**
   * Renders template with supplied variables.
   */
  render(purpose: SmsPurpose, lang: 'en' | 'bn', vars: TemplateVariables): string {
    const template = this.templates[purpose]?.[lang] || this.templates[purpose]?.en || '';
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = (vars as any)[key];
      return val !== undefined && val !== null ? String(val) : '';
    });
  }

  /**
   * Calculates SMS segments based on GSM 7-bit vs Unicode (Bangla) standard.
   */
  calculateSegments(text: string, costPerSegment = 0.35): SegmentAnalysis {
    const charCount = text.length;

    // Detect if message contains Unicode/Bangla characters outside basic ASCII
    const isUnicode = /[^\u0020-\u007E\n\r]/.test(text);

    let segmentCount = 1;

    if (isUnicode) {
      if (charCount <= 70) {
        segmentCount = 1;
      } else {
        segmentCount = Math.ceil(charCount / 67);
      }
    } else {
      if (charCount <= 160) {
        segmentCount = 1;
      } else {
        segmentCount = Math.ceil(charCount / 153);
      }
    }

    if (charCount === 0) segmentCount = 0;

    return {
      charCount,
      isUnicode,
      segmentCount,
      estimatedCost: segmentCount * costPerSegment,
    };
  }
}
