import { Boom } from '@hapi/boom';
const malformedOrder = (detail) => {
    throw new Boom(`Malformed order MEX response: ${detail}`, { statusCode: 502 });
};
const objectAt = (value, path, optional = false) => {
    if ((value === undefined || value === null) && optional)
        return undefined;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return malformedOrder(`${path} is not an object`);
    }
    return value;
};
const objectArrayAt = (value, path, optional = false) => {
    if ((value === undefined || value === null) && optional)
        return [];
    if (!Array.isArray(value))
        return malformedOrder(`${path} is not an array`);
    return value.map((entry, index) => objectAt(entry, `${path}[${index}]`));
};
const stringAt = (value, path) => {
    if (typeof value !== 'string' || !value.trim())
        return malformedOrder(`${path} is not a non-empty string`);
    return value;
};
const numberAt = (value, path) => {
    if (typeof value !== 'number' && typeof value !== 'string')
        return malformedOrder(`${path} is not numeric`);
    if (typeof value === 'string' && !value.trim())
        return malformedOrder(`${path} is not numeric`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return malformedOrder(`${path} is not numeric`);
    return parsed;
};
export const parseMexOrderDetails = (value) => {
    const order = objectAt(objectAt(value, 'MEX data-path result').order, 'order');
    const priceDetails = objectAt(order.price_details, 'order.price_details');
    const products = objectArrayAt(order.products, 'order.products').map((product, index) => {
        const path = `order.products[${index}]`;
        const media = objectAt(product.media, `${path}.media`, true);
        const images = objectArrayAt(media?.images, `${path}.media.images`, true);
        const imageUrl = images[0]?.request_image_url;
        return {
            id: stringAt(product.id, `${path}.id`),
            name: stringAt(product.name, `${path}.name`),
            imageUrl: typeof imageUrl === 'string' ? imageUrl : '',
            price: numberAt(product.price, `${path}.price`),
            currency: stringAt(product.currency, `${path}.currency`),
            quantity: numberAt(product.quantity, `${path}.quantity`)
        };
    });
    return {
        price: {
            total: numberAt(priceDetails.total_amount, 'order.price_details.total_amount'),
            currency: stringAt(priceDetails.currency, 'order.price_details.currency')
        },
        products
    };
};
//# sourceMappingURL=business-mex.js.map