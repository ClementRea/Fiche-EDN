# L'import de la fiche existante

La fiche de départ est un PDF de 28 pages exporté depuis macOS : 25 sections,
un tableau à deux colonnes « Notion clé / Ce qu'il faut retenir » par section,
des tableaux comparatifs autonomes et 12 schémas.

Le PDF ne porte plus aucune structure — ni tableau, ni cellule, ni ligne. Tout
est reconstruit à partir de la **géométrie**, mesurée sur le document :

| Signal | Valeur | Sert à |
|---|---|---|
| `xMin` d'une ligne | 72.00 vs 72.72 | séparer titres et paragraphes des cellules |
| hauteur de ligne | ≥ 17.8 | repérer un titre de spécialité |
| écart vertical | ≤ 11.5 repli, ≥ 12.0 nouvelle ligne | délimiter les lignes du tableau |
| `xMin` d'un mot | 72.7 / 197.8 / 232.8 / 322.8 / 447.8 | affecter chaque mot à sa colonne |

Quatre pièges ont demandé un traitement particulier :

- **La hauteur de ligne ment.** Des guillemets « » suffisent à faire passer une
  cellule pour un titre. C'est `xMin` qui départage, jamais la hauteur.
- **Une ligne peut chevaucher deux colonnes.** `pdftotext` fusionne parfois deux
  cellules partageant une ligne de base. L'affectation se fait donc mot par mot,
  et à la *dernière colonne commençant avant le mot* — pas à la plus proche,
  sans quoi un mot long bascule dans la colonne suivante.
- **L'en-tête se répète à chaque saut de page.** Laissé en place, il ouvrait une
  ligne de tableau qui avalait la fin de la cellule coupée par le saut.
- **Un saut de page remet `y` à zéro.** L'écart vertical n'y veut plus rien
  dire ; seule une puce y ouvre un nouveau paragraphe.

## Vérification

`tools/verify-import.mjs` compare le multi-ensemble des mots du PDF à celui du
JSON produit. Il échoue si un seul mot manque ou si un seul mot a été inventé.
Les seules omissions tolérées sont explicites : l'en-tête du document, et la
mention « (moyen mnémotechnique …) » sortie des titres pour devenir un bloc.

```
$ node tools/verify-import.mjs data/fiche.json
mots dans le PDF  : 6216
mots dans le JSON : 6187
manquants         : 29 (15 formes)
en trop           : 0 (0 formes)
  dont omissions voulues : 29
  PERTES INEXPLIQUÉES    : 0

✓ import verbatim : aucun mot perdu, aucun mot inventé.
```
