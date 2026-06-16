// Grading helper
export default function getGradeAndPoints(mark) {
  const m = Number(mark);
  if (isNaN(m) || mark === '' || mark === null || mark === undefined) 
    return { pl: null, points: null };
  if (m < 25)  return { pl: 'BE', points: 1 };
  if (m < 50)  return { pl: 'AE', points: 2 };
  if (m < 75)  return { pl: 'ME', points: 3 };
  return       { pl: 'EE', points: 4 };
}