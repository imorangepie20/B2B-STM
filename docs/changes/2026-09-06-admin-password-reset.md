# 기존 관리자 비밀번호 재설정

## 변경 이유

`admin:bootstrap`은 최초 system 관리자 생성만 허용하므로, 기존 초기 관리자의 비밀번호를 다시 설정하려는 경우 의도적으로 `Administrator already exists; bootstrap refused`를 반환합니다.

## 변경 내용

- `npm.cmd run admin:reset-password -- --email YOUR_EMAIL` 명령을 추가했습니다.
- TTY에서 새 비밀번호를 두 번 숨김 입력하며, 12~128자 조건을 검사합니다.
- 지정한 활성 system 관리자만 대상으로 Argon2id 비밀번호 해시를 교체합니다.
- 비밀번호 변경과 함께 해당 계정의 기존 세션을 모두 철회합니다. MFA 설정, 사용자 정보, 역할은 변경하지 않습니다.
- 개발 DB `b2b_stm` 외의 실행은 거부합니다.

## 검증

- 별도 bootstrap 검증에서 최초 생성은 한 번만 허용하고, 명시적 비밀번호 재설정은 해시 변경과 기존 세션 철회를 확인했습니다.
- `npm.cmd run test:foundation` 16개 테스트를 통과했습니다.
