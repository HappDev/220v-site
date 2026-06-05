import { describe, it, expect } from "vitest";

import { parseMessageForDisplay } from "@/pages/Chat";

function makeMessage(text: string) {
  return {
    id: 1,
    text,
    sender: "operator" as const,
    operatorName: "Оператор",
    dateTime: "",
    status: "",
  };
}

describe("parseMessageForDisplay", () => {
  it("извлекает картинку из строки оператора вида 'имя (размер) ссылка'", () => {
    const url =
      "https://fs.site-chat.me/2026/06/05/08689ce297934a9c5d47ada153b80493/telegram-cloud-photo-size-2-5264782040157067331-m.jpg";
    const result = parseMessageForDisplay(
      makeMessage(`5264782040157067331-m.jpg (8 Kb) ${url}`),
    );

    expect(result.text).toBe("");
    expect(result.attachments).toEqual([
      { url, fileName: "5264782040157067331-m.jpg", kind: "image" },
    ]);
  });

  it("поддерживает пробелы и скобки в имени файла оператора", () => {
    const url =
      "https://fs.site-chat.me/2026/06/05/dd2dd32df91c7dce82445086d2152570/ChatGPT%20Image%20May%2020%2C%202026%2C%2009_27_06%20PM%20%281%29.png";
    const result = parseMessageForDisplay(
      makeMessage(`ChatGPT Image May 20, 2026, 09_27_06 PM (1).png (272 Kb) ${url}`),
    );

    expect(result.text).toBe("");
    expect(result.attachments).toEqual([
      { url, fileName: "ChatGPT Image May 20, 2026, 09_27_06 PM (1).png", kind: "image" },
    ]);
  });

  it("сохраняет обычный текст вместе с inline-картинкой", () => {
    const url = "https://fs.site-chat.me/a/photo.png";
    const result = parseMessageForDisplay(
      makeMessage(`Вот скриншот\nscreen.png (12 Kb) ${url}`),
    );

    expect(result.text).toBe("Вот скриншот");
    expect(result.attachments).toEqual([
      { url, fileName: "screen.png", kind: "image" },
    ]);
  });

  it("не трогает обычный текст со скобками без ссылки", () => {
    const result = parseMessageForDisplay(
      makeMessage("Стоимость (примерно) 100 рублей"),
    );

    expect(result.text).toBe("Стоимость (примерно) 100 рублей");
    expect(result.attachments).toEqual([]);
  });

  it("разбирает наш собственный формат 'Файл: имя' + ссылка", () => {
    const url = "https://example.com/api/support/chat-attachment/doc.zip";
    const result = parseMessageForDisplay(makeMessage(`Файл: doc.zip\n${url}`));

    expect(result.text).toBe("");
    expect(result.attachments[0].url).toBe(url);
    expect(result.attachments[0].fileName).toBe("doc.zip");
  });
});
