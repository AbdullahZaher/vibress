import { describe, it, expect, beforeEach } from "vitest";
import {
  validateEntryData,
  ValidationError,
  ContentFieldDefinition,
} from "../index";

describe("Content Modeler Field Validation", () => {
  const schema: ContentFieldDefinition[] = [
    {
      id: "f1",
      name: "Product Name",
      key: "productName",
      type: "text",
      required: true,
    },
    {
      id: "f2",
      name: "Price",
      key: "price",
      type: "number",
      required: true,
    },
    {
      id: "f3",
      name: "In Stock",
      key: "inStock",
      type: "boolean",
    },
    {
      id: "f4",
      name: "Category",
      key: "category",
      type: "select",
      options: [
        { label: "Electronics", value: "electronics" },
        { label: "Apparel", value: "apparel" },
      ],
    },
    {
      id: "f5",
      name: "Release Date",
      key: "releaseDate",
      type: "date",
    },
  ];

  it("passes validation for complete valid entry data", () => {
    expect(() =>
      validateEntryData(
        {
          productName: "Wireless Headphones",
          price: 199.99,
          inStock: true,
          category: "electronics",
          releaseDate: "2026-08-15T00:00:00Z",
        },
        schema,
      ),
    ).not.toThrow();
  });

  it("throws ValidationError when required field is missing", () => {
    expect(() =>
      validateEntryData(
        {
          price: 199.99,
        },
        schema,
      ),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when numeric field receives non-number", () => {
    expect(() =>
      validateEntryData(
        {
          productName: "T-Shirt",
          price: "not-a-number" as unknown as number,
        },
        schema,
      ),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when select field receives unknown option", () => {
    expect(() =>
      validateEntryData(
        {
          productName: "Car",
          price: 25000,
          category: "automotive", // Not in options
        },
        schema,
      ),
    ).toThrow(ValidationError);
  });
});
