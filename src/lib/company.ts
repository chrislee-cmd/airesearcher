// 사업자 정보 SSOT — 약관/방침/푸터 등에서 import해서 사용.
// 변경 시 통신판매업 신고증·사업자등록증과 일치 여부 확인.

export const COMPANY = {
  nameKo: '주식회사 메테오리서치',
  nameEn: 'Meteor Research Co., Ltd.',
  representative: '이철희',
  bizRegNo: '870-86-03375',
  ecommerceRegNo: null as string | null,
  addressKo: '서울특별시 강동구 고덕비즈밸리로 26, 6층 에이 614호 (강동U1센터)',
  addressEn:
    'Room 614-A, 6F, Gangdong-U1 Center, 26 Godeokbizvalley-ro, Gangdong-gu, Seoul, Republic of Korea',
  email: 'chris.lee@meteor-research.com',
  phone: '010-4057-0872',
  privacyOfficer: '이철희 (대표)',
  serviceName: 'Research-mochi',
} as const;

export function companyInfoLinesKo(): string[] {
  return [
    `상호: ${COMPANY.nameKo}`,
    `대표자: ${COMPANY.representative}`,
    `사업자등록번호: ${COMPANY.bizRegNo}`,
    `통신판매업 신고번호: ${COMPANY.ecommerceRegNo ?? '신고 진행 중'}`,
    `사업장 소재지: ${COMPANY.addressKo}`,
    `유선번호: ${COMPANY.phone}`,
    `문의: ${COMPANY.email}`,
  ];
}

export function companyInfoLinesEn(): string[] {
  return [
    `Legal name: ${COMPANY.nameEn}`,
    `Representative: ${COMPANY.representative}`,
    `Business registration number: ${COMPANY.bizRegNo}`,
    `E-commerce registration: ${COMPANY.ecommerceRegNo ?? 'pending'}`,
    `Address: ${COMPANY.addressEn}`,
    `Phone: ${COMPANY.phone}`,
    `Contact: ${COMPANY.email}`,
  ];
}
