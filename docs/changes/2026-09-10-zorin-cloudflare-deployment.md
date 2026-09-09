# Zorin 배포 준비 및 검증

## 구현과 수정

독립 Compose 스택, API·Web Dockerfile, 운영 초기화 경계, API 요청 로그, GitHub CI 및 수동 가용성 검사를 추가했다. 업무 원장과 주문·재고·출고·정산 관계는 변경하지 않았다.

최초 CI에서 DB 권한 대상 역할 누락, `.env.local` 필수 의존, 테스트 전 API 빌드 누락, 존재하지 않는 디렉터리의 Git 제외 검사 오류를 확인해 수정했다. 로컬 기존 산출물이 깨끗한 checkout의 조건을 가렸던 것이 원인이다.

배포 설정 재검토에서 `APP_ORIGIN`, readiness 경로, 실제 로그인 페이지 `/`, ClamAV 업데이트용 외부 네트워크를 맞췄다. 초기 PostgreSQL은 과거 migration이 참조하는 테스트 역할을 `NOLOGIN`으로 생성한다. preflight 함수의 정상 반환값을 명시하고 Linux shell 파일에 LF를 적용한다. 실제 비밀값과 DEMO 자격 증명은 Git·Docker context에서 제외한다.

## 확인한 결과

- 로컬 foundation 테스트 79/79, API·Web 이미지 빌드 및 런타임 모듈 확인 통과.
- 수정된 PostgreSQL 초기화 스크립트로 새 일회성 DB를 생성하고 migration 38개 적용 통과. application 역할은 비슈퍼유저, 테스트 역할은 로그인 불가 확인.
- Compose 정적 검증, shell 문법 검사, 공개 저장소 검사 통과.
- Zorin SSH 및 Docker 정상, 대상 포트 미사용, 디스크·메모리 여유 확인.

## 아직 완료하지 않은 항목

최종 커밋의 CI 성공, Zorin 애플리케이션 실행, Gmail SMTP 인증, Cloudflare Tunnel·도메인 연결, 외부 인증·첨부 검사와 재부팅 확인은 후속 검증이 필요하다. 실제 배포 완료나 운영 성능 달성으로 표시하지 않는다.
