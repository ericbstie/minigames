// Schema helpers for data from outside that has to be read the way the games always read it, whatever is in it:
// saves in localStorage (an older version's, or one edited by hand) and the race messages. Shared by the page and the
// race server, so nothing here touches the browser.
import { Option, Schema, SchemaGetter } from 'effect';

/**
 * A field that always decodes: whatever came, missing included, is cleaned into a value instead of refusing the
 * whole thing. (What came is Any, not Unknown: saves are read as JSON, which checks that an Unknown holds JSON, and a
 * number too big for it, 1e999, reads as Infinity, which would throw the whole save away.)
 */
export const forgiving = <S extends Schema.Top>(to: S, clean: (v: unknown) => S['Encoded']) =>
  Schema.optionalKey(Schema.Any).pipe(
    Schema.decodeTo(to, {
      decode: SchemaGetter.transformOptional((v) => Option.some(clean(Option.getOrUndefined(v)))),
      encode: SchemaGetter.transformOptional((v) => v),
    }),
  );

/**
 * A saved list where only some entries can mean anything (level numbers, level names): those are kept and anything
 * else is dropped, so one odd entry doesn't lose the rest. Something that isn't a list doesn't fit at all.
 */
export const keepOnly = <A>(item: Schema.Codec<A>, keep: (v: unknown) => v is A) =>
  Schema.Array(Schema.Unknown).pipe(
    Schema.decodeTo(Schema.Array(item), {
      decode: SchemaGetter.transform((saved) => saved.filter(keep)),
      encode: SchemaGetter.passthroughSubtype(),
    }),
  );
