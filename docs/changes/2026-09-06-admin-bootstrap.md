# 초기 관리자 준비

관리자 초대 API는 system+MFA를 요구하므로, 첫 관리자는 로컬 CLI로 생성하도록 준비했습니다. 사용자가 지정한 이메일을 --email 인자로 받으며 비밀번호는 TTY 숨김 입력으로 두 번 확인합니다. 입력값이나 해시를 로그에 출력하지 않습니다.

```powershell
cd C:\Users\jowoo\B2B-STM
npm.cmd run build:api
npm.cmd run admin:bootstrap -- --email YOUR_EMAIL
```

비밀번호는 12–128자로 설정합니다. 기존 관리자(비활성 포함)가 하나라도 있으면 생성과 비밀번호 덮어쓰기를 거절합니다. 계정 생성 트랜잭션은 계정 생명주기와 같은 advisory lock을 사용합니다. 계정은 internal/system이며 MFA 확인이나 세션을 임의 생성하지 않습니다.

MFA_ENCRYPTION_KEY가 .env.local에 없으면 난수 키를 저장하고 있으면 형식 확인 후 유지합니다. .env.bootstrap.lock을 배타 생성해 동시 키 생성을 차단합니다. 비정상 종료 후 잠금 파일이 남으면 프로세스 종료를 확인한 후 잠금 파일만 정리합니다. DB 생성 실패 때도 이미 기록한 암호화 키는 유지합니다.

실행 후 API를 재시작해야 키가 로딩됩니다. 아직 계정 UI가 없으므로 실제 화면 로그인·MFA 등록 연결은 다음 작업입니다.

검증: 별도 실행 `node --env-file=.env.local --test scripts/tests/bootstrap.check.mjs` 통과. 실제 테스트 DB에서 두 동시 생성 중 1건 성공, system 역할, Argon2id 저장, 재실행 거절과 기존 해시 유지 확인. foundation 테스트가 임시 system 계정을 생성하므로 이 검증은 별도로 실행합니다. 2026-09-06에 개발 DB에서도 `npm.cmd run admin:verify`로 활성 계정·비밀번호 설정·system 역할·MFA 키 형식을 확인했습니다. 비밀번호·키·세션 값은 읽거나 출력하지 않았습니다.
