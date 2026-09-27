import test from "node:test";
import assert from "node:assert/strict";
import { distributePersonnel } from "../src/domain/personnel-distribution.js";

test("распределение назначает по одному оператору и упаковщику на выбранную линию", () => {
  const result = distributePersonnel({ lines: ["D", "F"], operatorIds: ["operator-1", "operator-2"], packerIds: ["packer-1", "packer-2"] }, () => 0);
  assert.deepEqual(result.lines, [
    { line: "D", operatorId: "operator-2", packerId: "packer-2" },
    { line: "F", operatorId: "operator-1", packerId: "packer-1" }
  ]);
  assert.deepEqual(result.unassignedOperatorIds, []);
  assert.deepEqual(result.unassignedPackerIds, []);
});

test("лишние выбранные сотрудники остаются без линии", () => {
  const result = distributePersonnel({ lines: ["D"], operatorIds: ["operator-1", "operator-2"], packerIds: ["packer-1", "packer-2", "packer-3"] }, () => 0);
  assert.deepEqual(result.lines, [{ line: "D", operatorId: "operator-2", packerId: "packer-2" }]);
  assert.deepEqual(result.unassignedOperatorIds, ["operator-1"]);
  assert.deepEqual(result.unassignedPackerIds, ["packer-3", "packer-1"]);
});
