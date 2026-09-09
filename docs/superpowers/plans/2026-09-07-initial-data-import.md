# 초기 데이터 CSV 이관 구현 계획

상태: 구현·검증 완료. 현재 사용 절차는 [초기 데이터 이관 안내](../../overview/initial-data-import-guide.md)를 기준으로 합니다.

1. CSV parser와 정규화·중복·참조 검증을 순수 함수 테스트로 고정합니다.
2. `import_batches`, `import_rows` migration과 DB 권한을 추가합니다.
3. preview/apply service를 구현하고 기존 기준정보 충돌, 원장 반영, 파일 hash 중복을 통합 테스트합니다.
4. MFA 관리자 API controller를 연결합니다.
5. `SDTPL_ADM` 구성으로 관리자 이관 화면과 navigation을 추가합니다.
6. 샘플 CSV를 제공하고 실제 브라우저에서 preview·오류 표시·apply를 검증합니다.
7. 전체 foundation, migration, API/web build, 운영 정합성을 실행하고 변경 문서를 갱신합니다.
