# 기능성 UI 정식 구현 하네스 규칙

## 변경 이유

차트처럼 데이터 표현과 접근성 동작이 필요한 UI를 CSS 외형으로만 재현하면 실제 컴포넌트의 툴팁, 빈 상태, 키보드·보조기술 지원과 유지보수성을 확보할 수 없습니다.

## 변경 내용

- 루트 `AGENTS.md`에 기능성 UI의 정식 컴포넌트 구현 원칙을 추가했습니다.
- 다른 프로젝트에 복사하는 `templates/AGENTS.template.md`에도 같은 규칙을 반영했습니다.
- `portable-harness-guide.md`의 UI 흐름에 라이브러리 확인, dependency 고정, 상호작용 검증 절차를 추가했습니다.
- `harness-manifest.yaml`에 기능성 UI·외형 모사 금지·브라우저 검증 품질 기준을 선언했습니다.

## 검증 기준

- 참조 테마가 사용하는 공식 컴포넌트 또는 기술 스택과 호환되는 검증된 라이브러리를 사용합니다.
- 데이터 연결, 상호작용, 빈 상태, 접근성과 반응형 동작을 구현합니다.
- production build와 실제 브라우저 검증을 통과하기 전 완료로 기록하지 않습니다.

## 이번 적용 검증

- `recharts@3.8.0` 설치와 Next.js production build: 통과
- 관리자 대시보드 `PieChart` 2개와 `RadialBarChart` 1개 SVG 렌더링: 통과
- 실제 chart sector hover tooltip: 통과
- 1440×900 및 390×844 브라우저 검사: 16/16 통과
