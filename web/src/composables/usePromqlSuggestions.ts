import searchService from "@/services/search";
import { getConsumableDateTime } from "@/utils/commons";
import { nextTick, ref } from "vue";
import { useStore } from "vuex";

const usePromlqSuggestions = () => {
  const autoCompleteData = ref({
    query: "",
    text: "",
    position: {
      cursorIndex: 0,
    },
    popup: {
      open: (val: string) => {},
      close: (val: string) => {},
    },
    dateTime: null,
  });
  const autoCompleteKeywords: any = ref([]);
  const store = useStore();
  const autoCompletePromqlKeywords: any = ref([]);
  const metricKeywords: any = ref([]);

  const parsePromQlQuery = (query: string) => {
    // Extract metric name
    const metricNameMatch = query.match(/(\w+)\{/);
    const metricName = metricNameMatch ? metricNameMatch[1] : null;

    // Extract labels
    const labelsMatch = query.match(/\{(.+?)\}/);
    const labels: { [key: string]: string } = {};
    if (labelsMatch) {
      const labelsStr = labelsMatch[1];
      const labelPairs = labelsStr.match(/(\w+)="([^"]*)"/g);
      if (labelPairs?.length)
        labelPairs.forEach((pair) => {
          const matchResult = pair.match(/(\w+)="([^"]*)"/);
          const [key, value] = matchResult
            ? matchResult.slice(1)
            : [null, null];
          if (key && value) labels[key] = value;
        });
    }

    return { metricName, labels };
  };

  function analyzeLabelFocus(query: string, cursorIndex: number) {
    const keyValuePairRegex = /\b(\w+)\s*=\s*("([^"]*)|,|\})/g;

    const labelMeta = {
      hasLabels: false,
      isFocused: false,
      isEmpty: true,
      focusOn: "", // label or value
      meta: {
        label: "",
        value: "",
      },
    };

    const curlyBracesRegex = /{([^{}]*?)}/;

    const hasCurlyBraces = curlyBracesRegex.exec(query);
    if (hasCurlyBraces) {
      labelMeta.hasLabels = true;
      labelMeta.isEmpty = !!hasCurlyBraces[1].length;
      labelMeta.isFocused =
        hasCurlyBraces.index <= cursorIndex &&
        hasCurlyBraces.index + hasCurlyBraces[1].length >= cursorIndex;
    }

    if (hasCurlyBraces) {
      const start = hasCurlyBraces.index;
      const end = start + hasCurlyBraces[0].length;
      if (start <= cursorIndex && cursorIndex <= end) {
        const value = hasCurlyBraces[0][cursorIndex - start];
        // Check is value
        if (
          (value === '"' &&
            hasCurlyBraces[0][cursorIndex - start + 1] === '"') ||
          value === "="
        ) {
          labelMeta["focusOn"] = "value";
        }

        if (
          (value === "{" &&
            hasCurlyBraces[0][cursorIndex - start + 1] === "}") ||
          (value === "," && hasCurlyBraces[0][cursorIndex - start - 1] === '"')
        ) {
          labelMeta["focusOn"] = "label";
        }
      }
    }

    // Extract labels
    let match;
    while (hasCurlyBraces && (match = keyValuePairRegex.exec(query)) !== null) {
      const [fullMatch, key, val, value] = match;
      const start = match.index;
      const end = start + fullMatch.length;
      // Detect cursor position for labels and values
      if (start <= cursorIndex && cursorIndex <= end) {
        if (cursorIndex - start < key.length) {
          labelMeta["focusOn"] = "label";
        } else if (
          key &&
          value &&
          cursorIndex - start < key.length + value.length
        ) {
          labelMeta["focusOn"] = "value";
        }

        labelMeta["meta"]["label"] = key;
        labelMeta["meta"]["value"] = value;

        break;
      }
    }

    return labelMeta;
  }

  const getSuggestions = async () => {
    try {
      const { metricName, labels }: any = parsePromQlQuery(
        autoCompleteData.value.query
      );
      autoCompletePromqlKeywords.value = [];
      const timestamps = getConsumableDateTime(autoCompleteData.value.dateTime);
      const startISOTimestamp: any =
        new Date(timestamps.start_time.toISOString()).getTime() * 1000;
      const endISOTimestamp: any =
        new Date(timestamps.end_time.toISOString()).getTime() * 1000;
      // import search service and call search.get_promql_series
      if (metricName) labels["__name__"] = metricName;

      const formattedLabels = Object.keys(labels).map((key) => {
        return `${key}="${labels[key]}"`;
      });

      const cursorIndex = autoCompleteData.value.position.cursorIndex;

      const labelFocus: any = analyzeLabelFocus(
        autoCompleteData.value.query,
        cursorIndex
      );

      console.log("update suggestions", labelFocus);

      if (cursorIndex === -1) return;

      if (!labelFocus.isFocused) {
        updatePromqlKeywords([]);
        return;
      }

      if (!(labelFocus.focusOn === "value" || labelFocus.focusOn === "label"))
        return;

      let labelSuggestions: any;

      autoCompletePromqlKeywords.value.push({
        label: "...Loading",
        insertText: "",
        kind: "Text",
      });

      autoCompleteData.value.popup.open(autoCompleteData.value.text);

      searchService
        .get_promql_series({
          org_identifier: store.state.selectedOrganization.identifier,
          labels: `{${formattedLabels.join(",")}}`,
          start_time: startISOTimestamp,
          end_time: endISOTimestamp,
        })
        .then((response: any) => {
          labelSuggestions = getLabelSuggestions(
            response.data.data,
            labelFocus,
            formattedLabels.join(",")
          );
        })
        .finally(() => {
          if (labelSuggestions) updatePromqlKeywords(labelSuggestions);
          else {
            autoCompletePromqlKeywords.value = [];
            autoCompleteData.value.popup.close("");
          }
        });
    } catch (e) {
      console.log(e);
    }
  };

  const getLabelSuggestions = (labels: any[], meta: any, queryLabels: any) => {
    const keywords: any = [];
    const keywordLabels: any = [];
    if (meta.focusOn === "label")
      Object.keys(labels[0]).forEach((key) => {
        if (queryLabels.indexOf(key + "=") === -1)
          keywords.push({
            label: key,
            kind: "Variable",
            insertText: key + "=",
          });
      });

    if (meta.focusOn === "value")
      labels.forEach((label: any) => {
        if (
          label[meta.meta.label] &&
          keywordLabels.indexOf(label[meta.meta.label]) === -1
        ) {
          keywordLabels.push(label[meta.meta.label]);
          keywords.push({
            label: label[meta.meta.label],
            kind: "Variable",
            insertText: `"${label[meta.meta.label]}"`,
          });
        }
      });
    return keywords;
  };

  const updatePromqlKeywords = async (data: any[]) => {
    autoCompletePromqlKeywords.value = [];
    const functions = [
      "sum",
      "avg_over_time",
      "rate",
      "avg",
      "max",
      "topk",
      "histogram_quantile",
    ];
    if (!data.length) {
      functions.forEach((fun) => {
        autoCompletePromqlKeywords.value.push({
          label: fun,
          kind: "Function",
          insertText: fun,
        });
      });
      autoCompletePromqlKeywords.value.push(...metricKeywords.value);
    } else {
      autoCompletePromqlKeywords.value.push(...data);
    }

    await nextTick();
    autoCompleteData.value.popup.open("");
  };

  const updateMetricKeywords = (metrics: any[]) => {
    metrics.forEach((metric: any) => {
      metricKeywords.value.push({
        label: metric.label,
        kind: "Variable",
        insertText: metric.label,
      });
    });
  };

  return {
    autoCompleteData,
    autoCompletePromqlKeywords,
    getSuggestions,
    updateMetricKeywords,
  };
};

export default usePromlqSuggestions;
