[English](README.md) | Korean

# MangoTL

MangoTL은 만화, 망가, 웹툰을 위한 AI 기반 번역 브라우저 확장프로그램이자 셀프 호스팅 가능한 서버입니다.

복잡한 작업 없이 Immersive Translate의 만화 번역 기능처럼 상업용 번역기 수준의 만화 번역을 수행하는것을 목표로 합니다.

## 지원 목록

MangoTL은 다양한 웹사이트, 언어, AI 제공자 등을 지원합니다.

아래에서 전체 목록을 확인하실수 있습니다.

### 웹사이트

- Pixiv.net

### 출발 언어 (만화 언어)

- 일본어
- 한국어
- 영어
- 라틴어

### 도착 언어 (당신의 언어)

- 한국어
- 일본어
- 영어
- 중국어

### AI 제공자

- [CrofAI](https://crof.ai)
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

3. `.env`에 제공자 API 키를 추가합니다.

    ```env
    CROFAI_API_KEY=your_api_key_here # 이 설정값은 예시입니다. 실제로 사용하는 제공자와 키로 변경하세요.
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
