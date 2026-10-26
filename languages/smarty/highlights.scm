; ---- Smarty ----

(smarty_comment) @comment

(smarty_open) @punctuation.special
(smarty_close) @punctuation.special

(smarty_variable) @variable
(smarty_string) @string
(smarty_number) @number
(smarty_operator) @operator
(smarty_punct) @punctuation
(smarty_brace) @punctuation.bracket

(smarty_keyword) @keyword
(smarty_ident) @function

; ---- HTML ----

(doctype) @constant
(tag_name) @tag
(attribute_name) @attribute
(attribute_value) @string
(quoted_attribute_value) @string
(entity) @constant
(comment) @comment
(erroneous_end_tag) @tag
(erroneous_end_tag_name) @tag

(script_element (start_tag (tag_name) @keyword))
(style_element (start_tag (tag_name) @keyword))

(raw_text) @string
