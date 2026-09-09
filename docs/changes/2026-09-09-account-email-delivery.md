# 계정 이메일 전달

## 변경 이유

초대·비밀번호 재설정 토큰을 관리자가 직접 전달해야 했고 발송 결과도 남지 않았습니다.

## 변경 내용

- SMTP가 설정되면 계정 초대와 비밀번호 재설정 발급 직후 사용자 이메일로 작업 링크를 보냅니다.
- 링크는 `/account-setup`에 작업 유형과 토큰을 자동 입력합니다.
- 발송 결과는 `account_email_deliveries`에 `pending`, `sent`, `failed`로 기록하며 토큰과 SMTP 오류 원문은 저장하지 않습니다.
- 발송 실패 시 계정·토큰 발급은 유지하고 관리자 화면에 직접 전달용 토큰을 한 번 표시합니다. 재초대·재설정은 새 토큰과 새 발송 시도를 만듭니다.
- 운영 환경은 `SMTP_URL`, `MAIL_FROM`을 필수로 검사합니다. 개발·테스트의 `MAIL_TRANSPORT=json`은 실제 네트워크 발송 없이 메시지 생성을 검증합니다.

## 운영 설정

```dotenv
SMTP_URL=smtps://USER:PASSWORD@SMTP_HOST:465
MAIL_FROM=STM <no-reply@example.com>
```

`SMTP_URL`은 비밀값으로 관리하고 문서·로그·Git에 기록하지 않습니다.

## 검증

- migration `0027_account_email_deliveries.sql`을 개발·테스트 DB에 적용했습니다.
- JSON transport로 발송 성공과 이력 저장을 검증했습니다.
- foundation 60건과 API·웹 production build가 통과했습니다.
