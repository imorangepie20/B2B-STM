# 도구·하네스·테마 계승

## 확정된 적용 범위

- 작업 루트: `C:\Users\jowoo\B2B-STM`.
- 기존 프로젝트의 문서화·근본 원인 수정·검증 원칙을 B2B 도메인으로 적용합니다.
- 현재 세션에 제공된 스킬과 호출 가능한 플러그인 도구를 과업에 맞게 사용합니다.
- 스킬 파일이나 플러그인 실행 환경을 저장소에 복제했다고 간주하지 않습니다. 세션·사용자 환경에서 제공되는 도구와 저장소 규칙은 별개입니다.
- 추천 플러그인 목록은 설치 완료 목록이 아닙니다. 새 연결·설치·자격 증명 복사는 수행하지 않았습니다.
- 기존 프로젝트의 Auth0·Cloudflare·DB·CI 설정은 B2B의 확정 설정이 아닙니다.

## 테마 원본 확인

사용자 최초 표기는 `SDTPL\_ADM`이며, 실제 확인한 경로는 `C:\Users\jowoo\B2B-STM\SDTPL_ADM`입니다.
원본에는 별도 `.git`과 `AGENTS.md`가 있습니다. 원본을 제품 저장소나 작업 디렉터리로 사용하지 않습니다.

2026-09-05 파일 확인 결과:

- `package.json`: Next.js `16.2.7`, React `19.2.4`, Tailwind CSS v4, shadcn/ui 및 Base UI 계열 의존성.
- `src/app/globals.css`: 무채색 기반 색상 토큰과 밝은/어두운 모드.
- `README.md`: 앱 셸, 사이드바, 테마 및 placeholder 화면을 설명합니다. 제품 업무 기능 완료의 근거가 아닙니다.
- 원본 지침은 구현 전 해당 Next.js 버전의 로컬 문서를 읽도록 요구합니다.

이는 파일 조사 결과이며 실행·빌드·시각 검수 결과가 아닙니다. 제품 기술 버전도 아직 확정하지 않았습니다.

## 테마 적용 절차

1. 제품 구현 전 테마 작업용 사본의 위치와 반영 범위를 정합니다.
2. 원본을 보존하며 별도 사본을 만듭니다. `.git`, 비밀값, 빌드 산출물은 가져오지 않습니다.
3. 관리자 목록·상세, 거래처 주문, 창고 모바일 대표 화면으로 색상·글꼴·밀도·터치 조작을 검토합니다.
4. 테마를 확정한 뒤 제품 UI에 적용합니다. 샘플 데이터와 placeholder는 실제 업무 구현으로 간주하지 않습니다.

## designlang 디자인 분석

- 사용자 지정 저장소는 `https://github.com/Manavarya09/design-extract.git`이며 실행 패키지명은 `designlang`입니다.
- Codex 플러그인 캐시의 `13.2.0` 스킬을 디자인 추출 절차에 사용하고, CLI는 GitHub 커밋 `a9e832efe304330a7fc491511c0ca30a34bc0106`을 `.tools/designlang`에 고정 설치합니다.
- `.tools/`와 `design-extract-output/`은 Git에서 제외해 제품 런타임과 배포 의존성에 포함하지 않습니다.
- 신규 UI와 큰 화면 개편 전에는 `SDTPL_ADM` 토큰·컴포넌트를 우선 적용합니다. `designlang`은 구현 화면의 색상·타이포그래피·간격·반응형·접근성 일관성을 측정하고 차이를 찾는 검증 도구로 사용합니다.

```powershell
npm.cmd run designlang:setup
npm.cmd run designlang:extract -- http://127.0.0.1:3101 --screenshots --out design-extract-output/b2b-login
```

인증 후 화면을 분석할 때는 임시 Playwright cookie 또는 storage state를 사용하고, 자격 증명이나 세션 파일을 Git에 포함하지 않습니다.

`theme-preview/`에 테마 검토용 사본을 생성했습니다. 원본의 `.git`과 환경 파일·설치 및 빌드 산출물을 제외하고 418개 파일을 복사해 SHA-256 해시 일치를 확인했습니다. 이후 사본 의존성 설치·앱 실행·빌드를 검증했습니다. 테마 확정과 브라우저 시각 검수는 아직 미완료이며 `docs/overview/theme-review.md`에 상세 결과를 기록합니다. 사본의 기존 docs는 원본 테마의 참고 이력이며 B2B 기획 승인 근거가 아닙니다.
