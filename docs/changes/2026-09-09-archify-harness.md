# Archify 설치와 재사용 하네스 반영

## 변경 이유

다른 프로젝트에서도 아키텍처와 업무 흐름을 같은 방식으로 시각화하고, 생성 파일이 실제 설계 근거와 검증 결과를 갖도록 재현 가능한 절차가 필요했습니다.

## 변경 내용

- `tt-a1i/archify`의 `archify` 스킬을 Codex 사용자 전역 디렉터리에 설치했습니다.
- 하네스 스킬 목록과 manifest에 source, commit, metadata version, folder hash, Node.js 요구사항을 기록했습니다.
- 설치·검증·업데이트 절차와 JSON/HTML 산출물·보안 경계를 `docs/harness/archify-guide.md`에 추가했습니다.
- 하네스 작업 흐름과 bootstrap 체크리스트에 조건부 구조 시각화 절차를 연결했습니다.

## 검증

- 설치 경로: `C:\Users\jowoo\.agents\skills\archify`
- `node bin\archify.mjs doctor`의 runtime, renderer, schema, preview, visual-check 항목이 모두 `[ok]`로 통과했습니다.
- 설치된 `SKILL.md`의 metadata version `2.17`과 원격 HEAD `10722002bb8777ecb639d93c49586fae4adf3ae4`를 확인했습니다.

## 제약

- 새로 설치한 스킬의 자동 탐지는 다음 Codex 대화부터 보장됩니다.
- Archify는 조건부 스킬이며 일반 코드 변경의 필수 단계가 아닙니다.
