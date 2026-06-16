export function validateSubjectScores(body) {
  const numericFields = [
    "english",
    "cre",
    "pre_technical",
    "integrated_science",
    "agriculture",
    "biology",
    "mathematics",
    "kiswahili",
    "creative_arts",
    "evrg",
  ];

  for (const key of numericFields) {
    if (body[key] !== undefined && body[key] !== "") {
      const v = Number(body[key]);
      if (Number.isNaN(v)) {
        return { valid: false, message: `Field ${key} must be a number` };
      }
      if (v < 0 || v > 100) {
        return {
          valid: false,
          message: `Field ${key} must be between 0 and 100`,
        };
      }
    }
  }
  return { valid: true };
}
