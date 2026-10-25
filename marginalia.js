// Each note is tied to an author's phrase, not to a fixed page number.
// Exact dates come from the manuscript; contextual dates name their source.
const events = [
  {
    match: 'Наша деревня — это Малое Бисярино.',
    phrase: 'Малое Бисярино',
    year: '1840-е',
    description: 'Малое Бисярино образовано в 1840-е годы.',
    source: 'https://chuvenc.ru/filter_from_MainTable_/%D0%9C?page=18',
  },
  { match: 'В 1964 году наши родители построили новый дом', phrase: '1964 году', year: '1964', description: 'Постройка семейного дома; год указан в тексте.' },
  { match: 'Самаркин Кирилл Павлович, родился 22 апреля 1929 года', phrase: '1929 года', year: '1929', description: 'Год рождения отца по семейному рассказу; в тексте оговорено расхождение со свидетельством.' },
  { match: 'В свои 15 лет поднимал полные мешки', phrase: '15 лет', year: '1944–45', description: 'Оценка по указанному в тексте году рождения отца (1929) и возрасту 15 лет.' },
  { match: 'Он пережил папу на 10 лет', phrase: '10 лет', year: 'ок. 2011', description: 'Оценка: дядя Сергей пережил отца на десять лет; год смерти отца — 2001.' },
  { match: 'В 26 лет папа женился', phrase: '26 лет', year: '1955–56', description: 'Оценка по году рождения отца (1929) и возрасту 26 лет при женитьбе.' },
  { match: 'Папа умер в 2001 году', phrase: '2001 году', year: '2001', description: 'Год смерти отца указан в тексте.' },
  { match: 'В 2019 году организовали в Бисярине', phrase: '2019 году', year: '2019', description: 'Вечер памяти отца; год указан в тексте.' },
  { match: 'Самаркина Тамара Алексеевна, родилась 25 декабря 1925', phrase: '1925', year: '1925', description: 'Год рождения матери указан в тексте.' },
  { match: 'когда дочке Тамаре было всего 3 годика', phrase: '3 годика', year: '1928–29', description: 'Оценка по дате рождения 25 декабря 1925 года и возрасту три года.' },
  { match: 'Началась гражданская война, муж ушёл воевать', phrase: 'гражданская война', year: '1917–22', description: 'Период Гражданской войны; точный год ухода Андрея в тексте не указан.', source: 'https://gwar.mil.ru/events/151/' },
  { match: 'А там мачеха (не очень добрая) и голод в Поволжье', phrase: 'голод в Поволжье', year: '1921–22', description: 'Период голода в Поволжье; год приезда семьи в тексте не указан.', source: 'https://docs.tgl.ru/arhivvistavki/item/v-epicentre-goloda.-chast-pervaya/' },
  { match: 'Когда началась коллективизация, было решено на собрании дедушку Павла Ивановича раскулачить', phrase: 'коллективизация', year: 'ок. 1930', description: 'Приблизительно: массовая коллективизация началась на рубеже 1929–1930 годов; точный год семейного события неизвестен.', source: 'https://www.prlib.ru/node/618998' },
  { match: 'Потом в девяностые годы начался процесс о реабилитации', phrase: 'девяностые годы', year: '1990-е', description: 'Десятилетие указано в тексте.' },
  { match: '18 лет в 1943 году, забрали на войну', phrase: '1943 году', year: '1943', description: 'Год призыва Василия указан в тексте.' },
  { match: '18 лет исполнилось в феврале 1945 года', phrase: '1945 года', year: '1945', description: 'Год призыва Сергея указан в тексте.' },
  { match: 'Вот семейная фотография 1929 года', phrase: '1929 года', year: '1929', description: 'Дата фотографии указана в тексте.' },
  { match: 'как она спасла его от голодной смерти во время голода в Поволжье', phrase: 'голода в Поволжье', year: '1921–22', description: 'Период голода в Поволжье; точный год этой истории в тексте не указан.', source: 'https://docs.tgl.ru/arhivvistavki/item/v-epicentre-goloda.-chast-pervaya/' },
  { match: 'Март 2021', phrase: '2021', year: '2021', description: 'Дата стихотворения указана в тексте.' },
  { match: 'Февраль 2022', phrase: '2022', year: '2022', description: 'Дата стихотворения указана в тексте.' },
  { match: '2015', phrase: '2015', year: '2015', description: 'Дата стихотворения указана в тексте.' },
  { match: '1999 год', phrase: '1999', year: '1999', description: 'Дата частушек указана в тексте.' },
];

export function addMarginalia(model) {
  const notes = events.map(event => {
    const anchor = model.blocks.find(block => block.kind === 'paragraph' && block.text.includes(event.match));
    return anchor ? { ...event, anchor: anchor.id } : null;
  }).filter(Boolean);
  return { ...model, marginalia: notes };
}
