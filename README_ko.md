[English](README.md) | Korean

# MangoTL

MangoTL은 만화, 망가, 웹툰을 위한 AI 기반 번역 브라우저 확장프로그램이자 셀프 호스팅 가능한 서버입니다.

## 애드온 스크린샷

<img width="190" alt="376711" src="https://github.com/user-attachments/assets/74f7cc2c-4c11-4c66-ad5a-bf5200758168" />
<img width="250" alt="376712" src="https://github.com/user-attachments/assets/722e52c5-ef4f-4b21-94aa-1aca45256e85" />
<img width="460" alt="376713" src="https://github.com/user-attachments/assets/083f12ad-3731-4370-8ba3-dcb41a3c0fdf" />

### 이미지 샘플

- 언어: 영어에서 한국어로
- 제공자: 오픈라우터
- 모델: google/gemma-4-26b-a4b-it

<img width="200" alt="CleanShot 2026-05-31 at 19 14 22" src="https://github.com/user-attachments/assets/2f35ee24-6632-4952-bf59-6de508960d10" />
<img width="200" alt="CleanShot 2026-05-31 at 19 14 02" src="https://github.com/user-attachments/assets/ee5ce9d7-fac8-4432-9a50-079698304547" />

## 지원 목록

MangoTL은 다양한 웹사이트, 언어, AI 제공자 등을 지원합니다.

아래에서 전체 목록을 확인하실수 있습니다.

### 웹사이트

- Pixiv.net
- X.com

### 출발 및 도착 언어

- 일본어
- 한국어
- 영어
- 중국어
- 독일어
- 스웨덴어

### AI 제공자

- [CrofAI](https://crof.ai)
- [OpenRouter](https://openrouter.ai)
- [OpenAI](https://openai.com)
- [Synthetic](https://synthetic.new)
- [Ollama](https://ollama.com) (로컬)
- [Ollama Cloud](https://ollama.com)
- [ZenMux](https://zenmux.ai)
- [Upstage](https://upstage.ai)

### 디텍션/OCR 엔진

- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) - 디텍션, OCR
- [manga-ocr](https://huggingface.co/mayocream/manga-ocr-onnx) (일본어 기본값) - OCR

## 서버 설치 및 설정

### 방법 1: Docker (권장)

요구사항: [Docker](https://www.docker.com/)

1. 이미지는 릴리즈마다 GHCR에 배포되며 아래 명령어로 실행할수 있습니다:

```sh
docker pull ghcr.io/gpdir16/mangotl
docker run -d --name mangotl \
    -p 8787:8787 \
    -v mangotl-secrets:/app/server/secrets \
    -v mangotl-ocr-cache:/app/server/.ocr-cache \
    --restart unless-stopped \
    ghcr.io/gpdir16/mangotl
```

> 설정은 `mangotl-secrets` 볼륨에 저장되고, 다운로드한 OCR 모델은 `mangotl-ocr-cache` 볼륨에 캐시됩니다.

2. 브라우저에서 http://localhost:8787/config 를 열고, 설정에서 제공자, API 키, 모델을 지정합니다.
3. 이제 브라우저 애드온을 통해 MangoTL을 사용할 수 있습니다. 브라우저 애드온 설치는 [브라우저 애드온 설치](#브라우저-애드온-설치) 섹션을 참고하세요.

### 방법 2: 직접 실행

요구사항: [Bun](https://bun.sh), [NodeJS](https://nodejs.org/ko), [Git](https://git-scm.com/)

1. 아래 명령어로 Git 레포를 클론하고 실행할수 있습니다:

```sh
git clone https://github.com/gpdir16/MangoTL.git
cd MangoTL
bun install
bun run start
```

> 설정은 `server/secrets/settings.json`에 저장됩니다.

2. localhost:8787/config 에서 제공자, API 키, 모델을 지정합니다.
3. 이제 브라우저 애드온을 통해 MangoTL을 사용할 수 있습니다. 브라우저 애드온 설치는 [브라우저 애드온 설치](#브라우저-애드온-설치) 섹션을 참고하세요.

## 브라우저 애드온 설치 및 설정

### 방법 1: Firefox Add-ons에서 설치 (권장)

1. [Firefox Add-ons](https://addons.mozilla.org/ko-KR/firefox/addon/mangotl/)에서 설치합니다.
2. 설치된 애드온 아이콘을 클릭 한 후 팝업에서 설정을 열어 서버 URL(변경한 경우)와 도착 언어를 설정합니다.
3. 이제 웹사이트에서 이미지를 바로 번역할수 있습니다. 위의 지원 웹사이트에서 시도해보세요.

### 방법 2: 직접 빌드 후 임시 설치

1. 릴리스 zip 빌드: `bun run release:extension`
2. Firefox에서 `about:debugging` → **이 Firefox** → **임시 부가 기능 로드** 후 `extension/` 안의 파일을 선택합니다.
3. 설치된 애드온 아이콘을 클릭 한 후 팝업에서 설정을 열어 서버 URL(변경한 경우)와 도착 언어를 설정합니다.
4. 이제 웹사이트에서 이미지를 바로 번역할수 있습니다. 위의 지원 웹사이트에서 시도해보세요.

## 문서

- [서드파티 소프트웨어](docs/THIRD_PARTY.md)
- [기여 가이드](CONTRIBUTING.md)

## 라이선스

MangoTL은 [GNU Affero General Public License v3.0 이상](LICENSE)(AGPL-3.0-or-later)으로 배포되는 자유 소프트웨어입니다.

Copyright © 2026 gpdir16 및 MangoTL 기여자.

이 소프트웨어를 수정해 네트워크로 제공하는 경우, 동일한 라이선스로 해당 소스 코드를 제공해야 합니다. 자세한 내용은 [AGPL FAQ](https://www.gnu.org/licenses/agpl-faq-ko.html)를 참고하세요.
