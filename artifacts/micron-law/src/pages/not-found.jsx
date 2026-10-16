import { Link } from 'wouter';
import { AuthFrame } from '@/components/kit';
export default function NotFound() {
  return (
    <AuthFrame>
      <p className="text-[12px] font-medium text-muted-foreground">خطأ 404</p>
      <h1 className="mt-1 text-[24px] font-semibold tracking-tight">الصفحة غير موجودة</h1>
      <p className="mt-2 text-[14px] text-muted-foreground">
        الرابط الذي فتحته غير صحيح أو لم يعد متاحًا.
      </p>
      <Link
        href="/"
        data-testid="link-back-home"
        className="mt-8 flex h-12 items-center justify-center rounded-lg bg-primary text-[15px] font-medium text-primary-foreground hover:opacity-90"
      >
        العودة إلى مساحة العمل
      </Link>
    </AuthFrame>
  );
}
