import test from "node:test";
import assert from "node:assert/strict";
import { translateUiText } from "../src/i18n.js";

test("интерфейсные подписи переводятся на английский", () => {
  assert.equal(translateUiText("Вид упаковки", "en"), "Packaging type");
  assert.equal(translateUiText("Крышка ДЗ белая", "en"), "DZ lid, white");
  assert.equal(translateUiText("Версия 0.9.5", "en"), "Version 0.9.5");
});

test("интерфейсные подписи переводятся на литовский", () => {
  assert.equal(translateUiText("Выберите упаковку", "lt"), "Pasirinkite pakuotę");
  assert.equal(translateUiText("Крышка ДЗ белая", "lt"), "Baltas DZ dangtelis");
  assert.equal(translateUiText("В ремонте: 2", "lt"), "Remontuojama: 2");
});

test("русский остаётся базовым языком", () => {
  assert.equal(translateUiText("Вид упаковки", "ru"), "Вид упаковки");
});
