[English](README.md) | Korean

# MangoTL

MangoTL은 만화, 망가, 웹툰을 위한 AI 기반 번역 브라우저 확장프로그램이자 셀프 호스팅 가능한 서버입니다.

복잡한 작업 없이 Immersive Translate의 만화 번역 기능처럼 상업용 번역기 수준의 만화 번역을 수행하는것을 목표로 합니다.

[Firefox Add-ons에서 보기](https://addons.mozilla.org/ko-KR/firefox/addon/mangotl/)

## 애드온 스크린샷

<img width="230" height="179" alt="376711" src="https://github.com/user-attachments/assets/74f7cc2c-4c11-4c66-ad5a-bf5200758168" />
<img width="314" height="228" alt="376712" src="https://github.com/user-attachments/assets/722e52c5-ef4f-4b21-94aa-1aca45256e85" />
<img width="533" height="314" alt="376713" src="https://github.com/user-attachments/assets/083f12ad-3731-4370-8ba3-dcb41a3c0fdf" />

### 이미지 샘플

- 언어: 영어에서 한국어로
- 제공자: 오픈라우터
- 모델: google/gemma-4-26b-a4b-it

<img width="230" alt="CleanShot 2026-05-31 at 19 14 22" src="https://github.com/user-attachments/assets/2f35ee24-6632-4952-bf59-6de508960d10" />
<img width="230" alt="CleanShot 2026-05-31 at 19 14 02" src="https://github.com/user-attachments/assets/ee5ce9d7-fac8-4432-9a50-079698304547" />

## 지원 목록

MangoTL은 다양한 웹사이트, 언어, AI 제공자 등을 지원합니다.

아래에서 전체 목록을 확인하실수 있습니다.

### 웹사이트

- Pixiv.net

### 출발 언어 (만화 언어)

- 일본어
- 한국어
- 영어
- 중국어
- 독일어
- 스웨덴어

### 도착 언어 (당신의 언어)

- 일본어
- 한국어
- 영어
- 중국어
- 독일어
- 스웨덴어

### AI 제공자

- [CrofAI](https://crof.ai)
- [OpenRouter](https://openrouter.ai)
- OpenAI 호환 엔드포인트

### 디텍션/OCR 엔진

- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) - 디텍션, OCR
- [manga-ocr](https://huggingface.co/mayocream/manga-ocr-onnx) (일본어 기본값) - OCR

## 서버 설정

1. 의존성을 설치합니다.

    ```sh
    bun install
    ```

2. 환경 파일을 만듭니다.

    ```sh
    cp .env.example .env
    ```

3. `.env`에 제공자 API 키와 제공자를 지정합니다. 아래는 OpenRouter를 사용하는 예시입니다.

    ```env
    OPENROUTER_API_KEY=your_api_key_here
    MANGOTL_AI_PROVIDER=openrouter
    ```

4. 서버를 시작합니다.

    ```sh
    bun start
    ```

5. 서버가 준비되었는지 확인합니다.

    ```sh
    curl http://localhost:8787/health
    ```

## 작동 순서

1. **브라우저:** 사용자가 이미지 위에 있는 버튼을 클릭합니다. 브라우저는 이미지 정보를 서버로 보냅니다.
2. **서버:** 이미지를 다운로드해 PaddleOCR, manga-ocr 등의 OCR 엔진을 이용해 텍스트를 추출합니다.
3. **서버:** 설정된 AI 모델로 추출된 텍스트를 전송해 번역합니다.
4. **서버:** 원본 이미지에서 망풍선 텍스트를 지우고 그 위에 번역된 텍스트를 삽입합니다. 완성된 이미지를 브라우저로 전송합니다.
5. **브라우저:** 받은 이미지를 원본 이미지 위에 합칩니다. 이제 사용자는 번역된 만화를 확인할수 있습니다.

## 확장 프로그램 설치

### Firefox Add-ons에서 설치 (권장)

1. [Firefox Add-ons](https://addons.mozilla.org/ko-KR/firefox/addon/mangotl/)에서 설치합니다.

### 직접 빌드 후 임시 설치

1. 릴리스 zip 빌드: `bun run release:extension`
2. Firefox에서 `about:debugging` → **이 Firefox** → **임시 부가 기능 로드** 후 `extension/` 안의 파일을 선택합니다.

## 문서

- [서드파티 소프트웨어](docs/THIRD_PARTY.md)
- [기여 가이드](CONTRIBUTING.md)

## 라이선스

MangoTL은 [GNU Affero General Public License v3.0 이상](LICENSE)(AGPL-3.0-or-later)으로 배포되는 자유 소프트웨어입니다.

Copyright © 2026 gpdir16 및 MangoTL 기여자.

이 소프트웨어를 수정해 네트워크로 제공하는 경우, 동일한 라이선스로 해당 소스 코드를 제공해야 합니다. 자세한 내용은 [AGPL FAQ](https://www.gnu.org/licenses/agpl-faq-ko.html)를 참고하세요.
