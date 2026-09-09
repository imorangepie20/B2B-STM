# designlang 디자인 분석 도구 연결

## 변경 이유

UI 품질을 육안 확인에만 의존하지 않고 `SDTPL_ADM` 기반 구현의 색상·글꼴·간격·접근성 일관성을 반복 측정할 도구가 필요했습니다. 사용자가 `Manavarya09/design-extract` 저장소를 지정했습니다.

## 변경 내용

- GitHub 현재 커밋 `a9e832efe304330a7fc491511c0ca30a34bc0106`의 `designlang 13.2.0`을 로컬 도구 영역에 고정 설치했습니다.
- `npm.cmd run designlang:setup`으로 같은 버전을 다시 설치할 수 있습니다.
- `npm.cmd run designlang:extract -- <URL> [options]`으로 디자인 언어와 토큰, shadcn 테마, Tailwind 설정, WCAG 결과, 스크린샷을 생성할 수 있습니다.
- 분석 도구와 산출물은 `.gitignore`에 포함해 제품 소스와 배포 의존성에서 분리했습니다.

## 검증 결과

`http://127.0.0.1:3101` 로그인 화면을 실제로 분석해 30개 이상의 산출물을 생성했습니다. 주요 결과는 다음과 같습니다.

- `designlang 13.2.0` 실행 확인
- Geist 자체 호스팅 폰트 감지
- 4px 기반 간격 체계 감지
- CSS custom property 125개 감지
- WCAG 색상 대비 검사 100%, 실패 조합 0개
- 디자인 점수 92/100, A 등급

산출물은 `design-extract-output/b2b-login`에 생성되며 로컬 검토용입니다.
